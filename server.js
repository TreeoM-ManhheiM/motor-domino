const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let salas = {};

// Gera as 28 peças do dominó e embaralha
function criarDominos() {
    let pecas = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) pecas.push([i, j]);
    }
    return pecas.sort(() => Math.random() - 0.5);
}

// Soma o total de pontos na mão de um jogador
function somarPontos(mao) {
    return mao.reduce((acc, p) => acc + p[0] + p[1], 0);
}

io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        socket.join(sala);
        minhaSala = sala;
        
        if (!salas[sala]) {
            // Adicionamos a variável 'passosSeguidos' para saber quando o jogo tranca
            salas[sala] = { jogadores: [], rodando: false, mesa: [], monte: [], turno: 0, prontos: 0, passosSeguidos: 0 };
        }
        
        if (salas[sala].jogadores.length < 4 && !salas[sala].rodando) {
            salas[sala].jogadores.push({ id: socket.id, nome: apelido, mao: [], pronto: false });
            io.to(sala).emit('estadoLobby', { rodando: false, jogadoresInfo: salas[sala].jogadores });
        }
    });

    socket.on('marcarPronto', () => {
        const s = salas[minhaSala];
        if (!s || s.rodando) return;
        
        const jogador = s.jogadores.find(p => p.id === socket.id);
        if (!jogador || jogador.pronto) return;

        jogador.pronto = true;
        s.prontos++;

        if (s.prontos >= s.jogadores.length) {
            s.rodando = true;
            s.monte = criarDominos();
            s.mesa = [];
            s.turno = 0;
            s.passosSeguidos = 0; // Zera a contagem de passos

            s.jogadores.forEach(j => {
                j.mao = s.monte.splice(0, 7);
                io.to(j.id).emit('atualizarMao', j.mao);
            });

            io.to(minhaSala).emit('jogoIniciado');
            io.to(minhaSala).emit('atualizarMesa', s.mesa);
            io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
        }
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
            if (lado === 'esq') {
                let pEsq = s.mesa[0][0];
                if (peca[1] === pEsq) s.mesa.unshift(peca);
                else if (peca[0] === pEsq) s.mesa.unshift(peca.reverse());
                else return socket.emit('erro', "Não encaixa na esquerda!");
            } else {
                let pDir = s.mesa[s.mesa.length - 1][1];
                if (peca[0] === pDir) s.mesa.push(peca);
                else if (peca[1] === pDir) s.mesa.push(peca.reverse());
                else return socket.emit('erro', "Não encaixa na direita!");
            }
        }

        // Se alguém jogou uma peça, o jogo NÃO está trancado, então zeramos a contagem
        s.passosSeguidos = 0;

        jogador.mao.splice(index, 1);
        socket.emit('atualizarMao', jogador.mao);
        io.to(minhaSala).emit('atualizarMesa', s.mesa);

        // REGRA DE BATIDA NORMAL
        if (jogador.mao.length === 0) {
            let resumo = s.jogadores.map(jog => `${jog.nome}: ${somarPontos(jog.mao)} pts`).join('\n');
            io.to(minhaSala).emit('mensagemGeral', `🏆 ${jogador.nome} BATEU!\n\nPontos restantes:\n${resumo}`);
            delete salas[minhaSala];
            return io.to(minhaSala).emit('resetJogo');
        }

        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return socket.emit('erro', "O monte acabou!");
        const j = s.jogadores.find(p => p.id === socket.id);
        if (s.jogadores.indexOf(j) !== s.turno) return;
        
        // Comprar também zera a contagem de trancamento, pois movimenta o jogo
        s.passosSeguidos = 0;

        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
    });

    socket.on('passarVez', () => {
        const s = salas[minhaSala];
        if (!s || !s.rodando) return;
        
        // Checa se é realmente a vez do jogador que apertou o botão
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (s.turno !== jIdx) return;

        // REGRA DO JOGO TRANCADO: Aumenta a contagem de pessoas que passaram a vez direto
        s.passosSeguidos++;

        // Se todo mundo da mesa passou a vez, o jogo TRANCOU!
        if (s.passosSeguidos >= s.jogadores.length) {
            let menorPonto = Infinity;
            let vencedores = [];

            // Calcula quem tem menos pontos
            s.jogadores.forEach(jog => {
                let pontos = somarPontos(jog.mao);
                jog.pontosAtuais = pontos;
                if (pontos < menorPonto) {
                    menorPonto = pontos;
                }
            });

            // Acha o nome de quem tem os menores pontos (pode dar empate)
            s.jogadores.forEach(jog => {
                if (jog.pontosAtuais === menorPonto) {
                    vencedores.push(jog.nome);
                }
            });

            let resumo = s.jogadores.map(jog => `${jog.nome}: ${jog.pontosAtuais} pts`).join('\n');
            io.to(minhaSala).emit('mensagemGeral', `🔒 O JOGO TRANCOU!\n\nVencedor(es) com menos pontos: ${vencedores.join(', ')}\n\nResumo:\n${resumo}`);
            
            delete salas[minhaSala];
            return io.to(minhaSala).emit('resetJogo');
        }

        // Se não trancou ainda, só passa a vez normalmente
        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });

    socket.on('disconnect', () => {
        if (minhaSala && salas[minhaSala]) {
            const s = salas[minhaSala];
            const jogadorSaiu = s.jogadores.find(p => p.id === socket.id);
            
            if (jogadorSaiu && jogadorSaiu.pronto && !s.rodando) {
                s.prontos--;
            }

            s.jogadores = s.jogadores.filter(p => p.id !== socket.id);
            
            if (s.jogadores.length === 0) {
                delete salas[minhaSala];
            } else if (!s.rodando) {
                io.to(minhaSala).emit('estadoLobby', { rodando: false, jogadoresInfo: s.jogadores });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
