const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let salas = {};

function criarDominos() {
    let pecas = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) pecas.push([i, j]);
    }
    return pecas.sort(() => Math.random() - 0.5);
}

// Função auxiliar para resetar a sala
function finalizarPartida(salaNome) {
    const s = salas[salaNome];
    if (!s) return;
    s.rodando = false;
    s.jogadores.forEach(j => { j.pronto = false; j.mao = []; });
    s.mesa = [];
    s.monte = [];
    io.to(salaNome).emit('estadoLobby', { rodando: false, jogadoresInfo: s.jogadores });
}

io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        minhaSala = sala;
        socket.join(sala);
        if (!salas[sala]) {
            salas[sala] = { jogadores: [], mesa: [], monte: [], turno: 0, rodando: false, passesSeguidos: 0 };
        }
        const s = salas[sala];
        if (s.rodando) return socket.emit('erroJogada', 'Sala em jogo.');
        if (s.jogadores.length >= 4) return socket.emit('erroJogada', 'Sala cheia.');
        
        s.jogadores.push({ id: socket.id, nome: apelido, pronto: false, mao: [] });
        io.to(sala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
    });

    socket.on('marcarPronto', () => {
        const s = salas[minhaSala];
        if (!s) return;
        const j = s.jogadores.find(p => p.id === socket.id);
        if (j) j.pronto = true;

        if (s.jogadores.length >= 2 && s.jogadores.every(p => p.pronto)) {
            s.rodando = true;
            s.monte = criarDominos();
            s.mesa = [];
            s.turno = 0;
            s.passesSeguidos = 0;
            
            s.jogadores.forEach(p => {
                p.mao = s.monte.splice(0, 7);
                io.to(p.id).emit('inicioJogo', { 
                    meuIndice: s.jogadores.indexOf(p), 
                    listaNomes: s.jogadores.map(pl => pl.nome), 
                    minhaMao: p.mao 
                });
            });
            io.to(minhaSala).emit('mudarTurno', { turno: s.turno, nome: s.jogadores[s.turno].nome });
            io.to(minhaSala).emit('atualizarMonte', s.monte.length);
        }
        io.to(minhaSala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
    });

    socket.on('jogarPeca', (index) => {
        const s = salas[minhaSala];
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (!s || !s.rodando || s.turno !== jIdx) return;

        let peca = s.jogadores[jIdx].mao[index];
        if (s.mesa.length === 0) {
            s.mesa.push(peca);
        } else {
            let pEsq = s.mesa[0][0];
            let pDir = s.mesa[s.mesa.length - 1][1];
            if (peca[0] === pDir) s.mesa.push(peca);
            else if (peca[1] === pDir) s.mesa.push(peca.reverse());
            else if (peca[1] === pEsq) s.mesa.unshift(peca);
            else if (peca[0] === pEsq) s.mesa.unshift(peca.reverse());
            else return socket.emit('erroJogada', 'Esta peça não encaixa!');
        }

        s.jogadores[jIdx].mao.splice(index, 1);
        s.passesSeguidos = 0; // Alguém jogou, reseta o contador de tranca
        
        socket.emit('atualizarMao', s.jogadores[jIdx].mao);
        io.to(minhaSala).emit('atualizarMesa', s.mesa);

        if (s.jogadores[jIdx].mao.length === 0) {
            io.to(minhaSala).emit('mensagemGeral', `🏆 FIM DE JOGO! ${s.jogadores[jIdx].nome} VENCEU!`);
            setTimeout(() => finalizarPartida(minhaSala), 5000); // 5 segundos para ver a vitória
        } else {
            s.turno = (s.turno + 1) % s.jogadores.length;
            io.to(minhaSala).emit('mudarTurno', { turno: s.turno, nome: s.jogadores[s.turno].nome });
        }
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return socket.emit('erroJogada', 'O monte está vazio!');
        const j = s.jogadores.find(p => p.id === socket.id);
        if (s.jogadores.indexOf(j) !== s.turno) return socket.emit('erroJogada', 'Não é sua vez!');

        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
        io.to(minhaSala).emit('atualizarMonte', s.monte.length);
    });

    socket.on('passarVez', () => {
        const s = salas[minhaSala];
        if (!s || s.turno !== s.jogadores.findIndex(p => p.id === socket.id)) return;
        if (s.monte.length > 0) return socket.emit('erroJogada', 'Você ainda pode comprar peças!');

        s.passesSeguidos++;
        if (s.passesSeguidos >= s.jogadores.length) {
            io.to(minhaSala).emit('mensagemGeral', "🚨 JOGO TRANCADO! Ninguém mais pode jogar.");
            setTimeout(() => finalizarPartida(minhaSala), 5000);
        } else {
            s.turno = (s.turno + 1) % s.jogadores.length;
            io.to(minhaSala).emit('mudarTurno', { turno: s.turno, nome: s.jogadores[s.turno].nome });
        }
    });

    socket.on('disconnect', () => {
        if (minhaSala && salas[minhaSala]) {
            const s = salas[minhaSala];
            s.jogadores = s.jogadores.filter(p => p.id !== socket.id);
            if (s.jogadores.length === 0) delete salas[minhaSala];
            else io.to(minhaSala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
        }
    });
});

server.listen(process.env.PORT || 3000);
