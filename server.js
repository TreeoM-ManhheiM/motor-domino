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

// Soma os pontos de uma mão
function somarPontos(mao) {
    return mao.reduce((acc, p) => acc + p[0] + p[1], 0);
}

io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        socket.join(sala);
        minhaSala = sala;
        if (!salas[sala]) {
            salas[sala] = { jogadores: [], rodando: false, mesa: [], monte: [], turno: 0 };
        }
        if (salas[sala].jogadores.length < 4 && !salas[sala].rodando) {
            salas[sala].jogadores.push({ id: socket.id, nome: apelido, mao: [] });
            io.to(sala).emit('estadoLobby', { rodando: false, jogadoresInfo: salas[sala].jogadores });
        }
    });

    socket.on('marcarPronto', () => {
        const s = salas[minhaSala];
        if (!s || s.rodando) return;
        
        s.rodando = true;
        s.monte = criarDominos();
        s.mesa = [];
        s.turno = 0;

        // Distribui 7 peças para cada (independente de ser 2, 3 ou 4 jogadores)
        s.jogadores.forEach(j => {
            j.mao = s.monte.splice(0, 7);
            io.to(j.id).emit('atualizarMao', j.mao);
        });

        io.to(minhaSala).emit('jogoIniciado');
        io.to(minhaSala).emit('atualizarMesa', s.mesa);
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });

    socket.on('jogarPeca', ({ index, lado }) => {
        const s = salas[minhaSala];
        if (!s || !s.rodando) return;
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (s.turno !== jIdx) return;

        let jogador = s.jogadores[jIdx];
        let peca = [...jogador.mao[index]];

        // Lógica de encaixe (Igual a anterior, com giro automático)
        if (s.mesa.length === 0) {
            s.mesa.push(peca);
        } else {
            if (lado === 'esq') {
                let pEsq = s.mesa[0][0];
                if (peca[1] === pEsq) s.mesa.unshift(peca);
                else if (peca[0] === pEsq) s.mesa.unshift(peca.reverse());
                else return socket.emit('erro', "Não encaixa!");
            } else {
                let pDir = s.mesa[s.mesa.length - 1][1];
                if (peca[0] === pDir) s.mesa.push(peca);
                else if (peca[1] === pDir) s.mesa.push(peca.reverse());
                else return socket.emit('erro', "Não encaixa!");
            }
        }

        jogador.mao.splice(index, 1);
        socket.emit('atualizarMao', jogador.mao);
        io.to(minhaSala).emit('atualizarMesa', s.mesa);

        // --- VERIFICAÇÃO DE VITÓRIA ---
        if (jogador.mao.length === 0) {
            let pontosGerais = s.jogadores.map(jog => `${jog.nome}: ${somarPontos(jog.mao)} pts`).join('\n');
            io.to(minhaSala).emit('mensagemGeral', `🏆 ${jogador.nome} BATEU O JOGO!\n\nSobra nas mãos:\n${pontosGerais}`);
            delete salas[minhaSala];
            return io.to(minhaSala).emit('resetJogo');
        }

        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });

    socket.on('passarVez', () => {
        const s = salas[minhaSala];
        if (!s) return;
        
        // Se todos passaram e ninguém consegue jogar, o jogo "trancou"
        // (Aqui poderíamos adicionar a lógica de verificar quem tem menos pontos)
        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return socket.emit('erro', "Monte vazio!");
        const j = s.jogadores.find(p => p.id === socket.id);
        if (s.jogadores.indexOf(j) !== s.turno) return;
        
        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
    });
});

server.listen(process.env.PORT || 3000, () => console.log("Servidor Online"));
