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

io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        minhaSala = sala;
        socket.join(sala);
        if (!salas[sala]) {
            salas[sala] = { jogadores: [], mesa: [], monte: [], turno: 0, rodando: false };
        }
        const s = salas[sala];
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
            s.jogadores.forEach(p => {
                p.mao = s.monte.splice(0, 7);
                io.to(p.id).emit('atualizarMao', p.mao);
            });
            io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
            io.to(minhaSala).emit('atualizarMonte', s.monte.length);
        }
        io.to(minhaSala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
    });

    socket.on('jogarPeca', ({ index, lado }) => {
        const s = salas[minhaSala];
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (!s || s.turno !== jIdx) return;

        let jogador = s.jogadores[jIdx];
        let peca = [...jogador.mao[index]];

        if (s.mesa.length === 0) {
            s.mesa.push(peca);
        } else {
            let pEsq = s.mesa[0][0];
            let pDir = s.mesa[s.mesa.length - 1][1];

            if (lado === 'dir') {
                if (peca[0] === pDir) s.mesa.push(peca);
                else if (peca[1] === pDir) s.mesa.push(peca.reverse());
            } else {
                if (peca[1] === pEsq) s.mesa.unshift(peca);
                else if (peca[0] === pEsq) s.mesa.unshift(peca.reverse());
            }
        }

        jogador.mao.splice(index, 1);
        socket.emit('atualizarMao', jogador.mao);
        io.to(minhaSala).emit('atualizarMesa', s.mesa);
        
        if (jogador.mao.length === 0) {
            io.to(minhaSala).emit('mensagemGeral', `🏆 ${jogador.nome} VENCEU!`);
            s.rodando = false;
        } else {
            s.turno = (s.turno + 1) % s.jogadores.length;
            io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
        }
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return;
        const j = s.jogadores.find(p => p.id === socket.id);
        if (s.jogadores.indexOf(j) !== s.turno) return;
        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
        io.to(minhaSala).emit('atualizarMonte', s.monte.length);
    });

    socket.on('passarVez', () => {
        const s = salas[minhaSala];
        if (!s || s.turno !== s.jogadores.findIndex(p => p.id === socket.id)) return;
        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });
});

server.listen(process.env.PORT || 3000);
