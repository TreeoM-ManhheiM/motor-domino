const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Estrutura para armazenar as salas: { "nomeDaSala": { jogadores: [], mesa: [], monte: [], turno: 0, rodando: false } }
let salas = {};

function criarDominos() {
    let pecas = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) pecas.push([i, j]);
    }
    pecas.sort(() => Math.random() - 0.5);
    return pecas;
}

io.on('connection', (socket) => {
    let salaAtual = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        salaAtual = sala;
        socket.join(sala);

        if (!salas[sala]) {
            salas[sala] = { jogadores: [], mesa: [], monte: [], turno: 0, rodando: false };
        }

        const s = salas[sala];
        if (s.rodando) return socket.emit('erroJogada', 'Esta sala já está em jogo.');
        if (s.jogadores.length >= 4) return socket.emit('erroJogada', 'Sala cheia!');

        s.jogadores.push({ id: socket.id, nome: apelido, pronto: false, mao: [] });
        
        io.to(sala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
        socket.emit('mensagemGeral', `Bem-vindo à sala: ${sala}`);
    });

    socket.on('marcarPronto', () => {
        const s = salas[salaAtual];
        if (!s) return;
        const j = s.jogadores.find(p => p.id === socket.id);
        if (j) j.pronto = true;

        if (s.jogadores.length >= 2 && s.jogadores.every(p => p.pronto)) {
            s.rodando = true;
            s.monte = criarDominos();
            s.mesa = [];
            s.turno = 0;
            s.jogadores.forEach(p => p.mao = s.monte.splice(0, 7));
            
            s.jogadores.forEach((p, i) => {
                io.to(p.id).emit('inicioJogo', { meuIndice: i, listaNomes: s.jogadores.map(pl => pl.nome), minhaMao: p.mao });
            });
            io.to(salaAtual).emit('mudarTurno', { turno: s.turno, nome: s.jogadores[s.turno].nome });
        }
        io.to(salaAtual).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
    });

    socket.on('jogarPeca', (index) => {
        const s = salas[salaAtual];
        if (!s || !s.rodando) return;
        const jIndice = s.jogadores.findIndex(p => p.id === socket.id);
        if (jIndice !== s.turno) return socket.emit('erroJogada', 'Não é sua vez!');

        let peca = s.jogadores[jIndice].mao[index];
        if (s.mesa.length === 0) {
            s.mesa.push(peca);
        } else {
            let pontaEsq = s.mesa[0][0];
            let pontaDir = s.mesa[s.mesa.length - 1][1];

            if (peca[0] === pontaDir) { s.mesa.push(peca); }
            else if (peca[1] === pontaDir) { s.mesa.push(peca.reverse()); }
            else if (peca[1] === pontaEsq) { s.mesa.unshift(peca); }
            else if (peca[0] === pontaEsq) { s.mesa.unshift(peca.reverse()); }
            else { return socket.emit('erroJogada', 'Peça não encaixa!'); }
        }

        s.jogadores[jIndice].mao.splice(index, 1);
        socket.emit('atualizarMao', s.jogadores[jIndice].mao);
        io.to(salaAtual).emit('atualizarMesa', s.mesa);

        if (s.jogadores[jIndice].mao.length === 0) {
            io.to(salaAtual).emit('mensagemGeral', `🏆 ${s.jogadores[jIndice].nome} VENCEU!`);
            s.rodando = false;
        } else {
            s.turno = (s.turno + 1) % s.jogadores.length;
            io.to(salaAtual).emit('mudarTurno', { turno: s.turno, nome: s.jogadores[s.turno].nome });
        }
    });

    socket.on('comprarPeca', () => {
        const s = salas[salaAtual];
        if (!s || s.monte.length === 0) return socket.emit('erroJogada', 'Monte vazio!');
        const j = s.jogadores.find(p => p.id === socket.id);
        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
        io.to(salaAtual).emit('atualizarMonte', s.monte.length);
    });

    socket.on('disconnect', () => {
        if (salaAtual && salas[salaAtual]) {
            const s = salas[salaAtual];
            s.jogadores = s.jogadores.filter(p => p.id !== socket.id);
            if (s.jogadores.length === 0) delete salas[salaAtual];
            else io.to(salaAtual).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
