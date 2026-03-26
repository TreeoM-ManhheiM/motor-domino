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

function temPecaQueServe(mao, mesa) {
    if (mesa.length === 0) return true;
    const pEsq = mesa[0][0];
    const pDir = mesa[mesa.length - 1][1];
    return mao.some(p => p[0] === pEsq || p[1] === pEsq || p[0] === pDir || p[1] === pDir);
}

function iniciarPartida(salaNome) {
    const s = salas[salaNome];
    if (!s || s.rodando) return;
    s.rodando = true;
    s.monte = criarDominos();
    s.mesa = [];
    s.turno = 0;

    if (s.jogadores.length === 4) {
        s.jogadores[0].dupla = s.jogadores[2].nome;
        s.jogadores[2].dupla = s.jogadores[0].nome;
        s.jogadores[1].dupla = s.jogadores[3].nome;
        s.jogadores[3].dupla = s.jogadores[1].nome;
    }

    s.jogadores.forEach(p => {
        p.mao = s.monte.splice(0, 7);
        io.to(p.id).emit('atualizarMao', p.mao);
        io.to(p.id).emit('infoParceiro', p.dupla || "Sem dupla (1x1)");
    });

    io.to(salaNome).emit('estadoLobby', { rodando: true, jogadoresInfo: s.jogadores });
    io.to(salaNome).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    io.to(salaNome).emit('atualizarMonte', s.monte.length);
}

io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        minhaSala = sala;
        socket.join(sala);
        if (!salas[sala]) salas[sala] = { jogadores: [], mesa: [], monte: [], turno: 0, rodando: false };
        const s = salas[sala];
        if (!s.jogadores.find(p => p.id === socket.id)) {
            s.jogadores.push({ id: socket.id, nome: apelido, pronto: false, mao: [] });
        }
        io.to(sala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
        if (s.jogadores.length === 4) iniciarPartida(sala);
    });

    socket.on('marcarPronto', () => {
        const s = salas[minhaSala];
        if (!s) return;
        const j = s.jogadores.find(p => p.id === socket.id);
        if (j) j.pronto = true;
        if (s.jogadores.length >= 2 && s.jogadores.every(p => p.pronto)) iniciarPartida(minhaSala);
        else io.to(minhaSala).emit('estadoLobby', { rodando: false, jogadoresInfo: s.jogadores });
    });

    socket.on('jogarPeca', ({ index, lado }) => {
        const s = salas[minhaSala];
        if (!s || !s.rodando) return;
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (s.turno !== jIdx) return;

        let jogador = s.jogadores[jIdx];
        let peca = [...jogador.mao[index]];

        if (s.mesa.length === 0) {
            s.mesa.push(peca);
        } else {
            let pEsq = s.mesa[0][0], pDir = s.mesa[s.mesa.length - 1][1];
            if (lado === 'dir') {
                if (peca[0] === pDir) s.mesa.push(peca);
                else if (peca[1] === pDir) s.mesa.push(peca.reverse());
                else return socket.emit('erro', "Não encaixa!");
            } else {
                if (peca[1] === pEsq) s.mesa.unshift(peca);
                else if (peca[0] === pEsq) s.mesa.unshift(peca.reverse());
                else return socket.emit('erro', "Não encaixa!");
            }
        }

        jogador.mao.splice(index, 1);
        socket.emit('atualizarMao', jogador.mao);
        io.to(minhaSala).emit('atualizarMesa', s.mesa);
        
        if (jogador.mao.length === 0) {
            const vitoriaMsg = jogador.dupla ? `🏆 DUPLA ${jogador.nome} & ${jogador.dupla} VENCEU!` : `🏆 ${jogador.nome} VENCEU!`;
            io.to(minhaSala).emit('mensagemGeral', vitoriaMsg);
            
            // AUTO-LIMPEZA: Reseta a sala após vitória para nova partida
            delete salas[minhaSala]; 
            io.to(minhaSala).emit('resetJogo');
        } else {
            s.turno = (s.turno + 1) % s.jogadores.length;
            io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
        }
    });

    socket.on('disconnect', () => {
        if (minhaSala && salas[minhaSala]) {
            salas[minhaSala].jogadores = salas[minhaSala].jogadores.filter(p => p.id !== socket.id);
            if (salas[minhaSala].jogadores.length === 0) {
                delete salas[minhaSala]; // LIMPEZA: Sala vazia é removida
            } else {
                io.to(minhaSala).emit('estadoLobby', { rodando: salas[minhaSala].rodando, jogadoresInfo: salas[minhaSala].jogadores });
            }
        }
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return;
        const j = s.jogadores.find(p => p.id === socket.id);
        if (s.jogadores.indexOf(j) !== s.turno) return;
        if (temPecaQueServe(j.mao, s.mesa)) return socket.emit('erro', "Você já tem peça que serve!");
        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
        io.to(minhaSala).emit('atualizarMonte', s.monte.length);
    });

    socket.on('passarVez', () => {
        const s = salas[minhaSala];
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (!s || s.turno !== jIdx) return;
        if (s.monte.length > 0 || temPecaQueServe(s.jogadores[jIdx].mao, s.mesa)) return socket.emit('erro', "Não pode passar!");
        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });
});

server.listen(process.env.PORT || 3000);
