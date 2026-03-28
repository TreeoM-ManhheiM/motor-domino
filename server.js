const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 1. CORS LIBERADO: Garante que o Git (Front) consiga falar com o Render (Back) sem bloqueios
const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"] 
    } 
});

let salas = {};

// 2. EMBARALHAMENTO PROFISSIONAL (Fisher-Yates)
function criarDominos() {
    let pecas = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) pecas.push([i, j]);
    }
    for (let i = pecas.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pecas[i], pecas[j]] = [pecas[j], pecas[i]];
    }
    return pecas;
}

// Verifica se existe alguma peça na mão que encaixa na mesa
function temPecaQueServe(mao, mesa) {
    if (mesa.length === 0) return true;
    const pEsq = mesa[0][0];
    const pDir = mesa[mesa.length - 1][1];
    return mao.some(p => p[0] === pEsq || p[1] === pEsq || p[0] === pDir || p[1] === pDir);
}

// 3. CÁLCULO DE PONTOS (Para quando o jogo trancar)
function calcularPontos(mao) {
    return mao.reduce((total, peca) => total + peca[0] + peca[1], 0);
}

function iniciarPartida(salaNome) {
    const s = salas[salaNome];
    if (!s || s.rodando) return;
    s.rodando = true;
    s.monte = criarDominos();
    s.mesa = [];
    s.turno = 0;
    s.passesConsecutivos = 0; // Novo: Contador para saber se o jogo trancou

    // Lógica original de duplas
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
    // Adicionei o emit do jogoIniciado para o seu modal gamificado sumir na hora certa
    io.to(salaNome).emit('jogoIniciado'); 
    io.to(salaNome).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    io.to(salaNome).emit('atualizarMonte', s.monte.length);
}

io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ apelido, sala }) => {
        minhaSala = sala;
        socket.join(sala);
        if (!salas[sala]) salas[sala] = { jogadores: [], mesa: [], monte: [], turno: 0, rodando: false, passesConsecutivos: 0 };
        const s = salas[sala];
        
        // Bloqueio de sala cheia ou rodando
        if (s.jogadores.length >= 4 && !s.jogadores.find(p => p.id === socket.id)) {
            return socket.emit('erro', "Sala cheia!");
        }
        if (s.rodando && !s.jogadores.find(p => p.id === socket.id)) {
            return socket.emit('erro', "Jogo já em andamento!");
        }

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
        s.passesConsecutivos = 0; // Reset do contador de trancamento

        socket.emit('atualizarMao', jogador.mao);
        io.to(minhaSala).emit('atualizarMesa', s.mesa);
        
        // CONDIÇÃO 1: ALGUÉM BATEU
        if (jogador.mao.length === 0) {
            const vitoriaMsg = jogador.dupla ? `A DUPLA ${jogador.nome} & ${jogador.dupla} BATEU E VENCEU!` : `O JOGADOR ${jogador.nome} BATEU E VENCEU!`;
            
            // Emite para a modal gamificada (novo) e para a lógica antiga
            io.to(minhaSala).emit('fimDeJogo', { motivo: "🎯 BATIDA!", mensagem: vitoriaMsg });
            io.to(minhaSala).emit('mensagemGeral', vitoriaMsg);
            
            delete salas[minhaSala]; 
            io.to(minhaSala).emit('resetJogo');
            io.to(minhaSala).emit('estadoLobby', { rodando: false, jogadoresInfo: [] });
        } else {
            s.turno = (s.turno + 1) % s.jogadores.length;
            io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
        }
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return socket.emit('erro', "O monte está vazio!");
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
        
        if (s.monte.length > 0) return socket.emit('erro', "Ainda há peças no monte para comprar!");
        if (temPecaQueServe(s.jogadores[jIdx].mao, s.mesa)) return socket.emit('erro', "Você tem peça para jogar!");
        
        s.passesConsecutivos++;

        // 4. CONDIÇÃO 2: JOGO TRANCADO
        if (s.passesConsecutivos >= s.jogadores.length) {
            let msgTrancado = "";
            
            // Regra para 4 jogadores (Duplas)
            if (s.jogadores.length === 4) {
                let ptsEq1 = calcularPontos(s.jogadores[0].mao) + calcularPontos(s.jogadores[2].mao);
                let ptsEq2 = calcularPontos(s.jogadores[1].mao) + calcularPontos(s.jogadores[3].mao);
                
                if (ptsEq1 < ptsEq2) msgTrancado = `A equipe de ${s.jogadores[0].nome} venceu por pontos (${ptsEq1} a ${ptsEq2}).`;
                else if (ptsEq2 < ptsEq1) msgTrancado = `A equipe de ${s.jogadores[1].nome} venceu por pontos (${ptsEq2} a ${ptsEq1}).`;
                else msgTrancado = `Empate! Ambas as equipes com ${ptsEq1} pontos!`;
            } 
            // Regra para 2 ou 3 jogadores (Individual)
            else {
                let menorPonto = Infinity;
                let vencedores = [];
                s.jogadores.forEach(jog => {
                    let pts = calcularPontos(jog.mao);
                    if (pts < menorPonto) { menorPonto = pts; vencedores = [jog.nome]; } 
                    else if (pts === menorPonto) { vencedores.push(jog.nome); }
                });
                msgTrancado = `${vencedores.join(' e ')} venceu com ${menorPonto} pontos!`;
            }

            // Emite para a modal gamificada e avisa geral
            io.to(minhaSala).emit('fimDeJogo', { motivo: "🔒 JOGO TRANCADO", mensagem: msgTrancado });
            io.to(minhaSala).emit('mensagemGeral', `JOGO TRANCADO! ${msgTrancado}`);
            
            delete salas[minhaSala];
            io.to(minhaSala).emit('resetJogo');
            io.to(minhaSala).emit('estadoLobby', { rodando: false, jogadoresInfo: [] });
            return;
        }

        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
    });

    // 5. PROTEÇÃO CONTRA CRASH: Desconexão segura
    socket.on('disconnect', () => {
        if (minhaSala && salas[minhaSala]) {
            const s = salas[minhaSala];
            const jogadorSaiu = s.jogadores.find(p => p.id === socket.id);
            
            s.jogadores = s.jogadores.filter(p => p.id !== socket.id);
            
            if (s.jogadores.length === 0) {
                delete salas[minhaSala]; // LIMPEZA: Sala vazia é removida
            } else if (s.rodando) {
                // Se estava rodando, cancela para não quebrar o servidor
                const msgAbandono = `A partida foi cancelada porque ${jogadorSaiu ? jogadorSaiu.nome : 'alguém'} saiu.`;
                io.to(minhaSala).emit('fimDeJogo', { motivo: "🚨 PARTIDA CANCELADA", mensagem: msgAbandono });
                io.to(minhaSala).emit('mensagemGeral', msgAbandono);
                
                delete salas[minhaSala];
                io.to(minhaSala).emit('resetJogo');
                io.to(minhaSala).emit('estadoLobby', { rodando: false, jogadoresInfo: [] });
            } else {
                io.to(minhaSala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
