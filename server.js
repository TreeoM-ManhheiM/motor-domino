const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve os arquivos estáticos (HTML, CSS) da pasta atual
app.use(express.static(__dirname));

let salas = {};

// Função para gerar as 28 peças do dominó
function criarDominos() {
    let pecas = [];
    for (let i = 0; i <= 6; i++) {
        for (let j = i; j <= 6; j++) pecas.push([i, j]);
    }
    return pecas.sort(() => Math.random() - 0.5); // Embaralha as peças
}

// Verifica se existe alguma peça na mão que encaixa na mesa
function temPecaQueServe(mao, mesa) {
    if (mesa.length === 0) return true;
    const pEsq = mesa[0][0];
    const pDir = mesa[mesa.length - 1][1];
    return mao.some(p => p[0] === pEsq || p[1] === pEsq || p[0] === pDir || p[1] === pDir);
}

// NOVA REGRA: Calcula os pontos da mão de um jogador
function calcularPontos(mao) {
    return mao.reduce((total, peca) => total + peca[0] + peca[1], 0);
}

// NOVA REGRA: Finaliza o jogo, avisa a todos e reseta o lobby
function finalizarJogo(salaNome, motivo, mensagem) {
    const s = salas[salaNome];
    if (!s) return;
    io.to(salaNome).emit('fimDeJogo', { motivo, mensagem });
    s.rodando = false;
    // Avisa todos para atualizar os botões do lobby
    io.to(salaNome).emit('estadoLobby', { rodando: false, jogadoresInfo: s.jogadores });
}

// Inicia a partida e distribui as peças
function iniciarPartida(salaNome) {
    const s = salas[salaNome];
    if (!s || s.rodando) return;
    
    s.rodando = true;
    s.monte = criarDominos();
    s.mesa = [];
    s.turno = 0;
    s.passesConsecutivos = 0; // Zera o contador de passes

    // Distribui 7 peças para cada jogador
    s.jogadores.forEach(j => {
        j.mao = s.monte.splice(0, 7);
    });

    // Avisa todos que o jogo começou
    io.to(salaNome).emit('jogoIniciado');
    io.to(salaNome).emit('atualizarMesa', s.mesa);
    io.to(salaNome).emit('atualizarTurno', s.turno);
    io.to(salaNome).emit('atualizarMonte', s.monte.length);
    io.to(salaNome).emit('atualizarJogadores', s.jogadores.map(p => ({ nome: p.nome, pecas: p.mao.length })));

    // Envia a mão secreta apenas para o dono
    s.jogadores.forEach(j => {
        io.to(j.id).emit('atualizarMao', j.mao);
    });
}

// CONEXÃO SOCKET.IO
io.on('connection', (socket) => {
    let minhaSala = null;

    socket.on('entrarSala', ({ nomeJogador, nomeSala }) => {
        minhaSala = nomeSala;
        socket.join(nomeSala);

        if (!salas[nomeSala]) {
            salas[nomeSala] = { jogadores: [], rodando: false, monte: [], mesa: [], turno: 0, passesConsecutivos: 0 };
        }

        const s = salas[nomeSala];
        if (s.jogadores.length >= 4) {
            return socket.emit('erro', "Sala cheia! Máximo de 4 jogadores.");
        }
        if (s.rodando) {
            return socket.emit('erro', "O jogo já está em andamento nesta sala.");
        }

        s.jogadores.push({ id: socket.id, nome: nomeJogador, mao: [] });
        io.to(nomeSala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
    });

    socket.on('iniciarJogo', () => {
        const s = salas[minhaSala];
        if (s && s.jogadores.length >= 2) {
            iniciarPartida(minhaSala);
        } else {
            socket.emit('erro', "Mínimo de 2 jogadores para iniciar.");
        }
    });

    socket.on('jogarPeca', ({ index, lado }) => {
        const s = salas[minhaSala];
        if (!s || !s.rodando) return;
        
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (jIdx !== s.turno) return socket.emit('erro', "Não é a sua vez!");

        const j = s.jogadores[jIdx];
        const peca = j.mao[index];

        if (!peca) return;

        // Regra de encaixe na mesa
        if (s.mesa.length === 0) {
            s.mesa.push(peca);
        } else {
            const pEsq = s.mesa[0][0];
            const pDir = s.mesa[s.mesa.length - 1][1];

            if (lado === 'esq') {
                if (peca[1] === pEsq) s.mesa.unshift(peca);
                else if (peca[0] === pEsq) s.mesa.unshift([peca[1], peca[0]]); // Inverte
                else return socket.emit('erro', "Jogada inválida.");
            } else if (lado === 'dir') {
                if (peca[0] === pDir) s.mesa.push(peca);
                else if (peca[1] === pDir) s.mesa.push([peca[1], peca[0]]); // Inverte
                else return socket.emit('erro', "Jogada inválida.");
            }
        }

        // Remove a peça da mão e reseta contador de passes
        j.mao.splice(index, 1);
        s.passesConsecutivos = 0;

        io.to(minhaSala).emit('atualizarMesa', s.mesa);
        socket.emit('atualizarMao', j.mao);
        io.to(minhaSala).emit('atualizarJogadores', s.jogadores.map(p => ({ nome: p.nome, pecas: p.mao.length })));

        // NOVA REGRA: CONDIÇÃO DE VITÓRIA POR BATIDA
        if (j.mao.length === 0) {
            let msgVitoria = `${j.nome} bateu e venceu o jogo!`;
            if (s.jogadores.length === 4) {
                let equipe = (jIdx % 2 === 0) ? "Equipe 1 (Jogadores 1 e 3)" : "Equipe 2 (Jogadores 2 e 4)";
                msgVitoria = `${j.nome} bateu! A ${equipe} venceu a partida!`;
            }
            return finalizarJogo(minhaSala, "🎯 BATIDA!", msgVitoria);
        }

        // Passa o turno
        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('atualizarTurno', s.turno);
    });

    socket.on('comprarPeca', () => {
        const s = salas[minhaSala];
        if (!s || s.monte.length === 0) return socket.emit('erro', "O monte está vazio!");
        
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (jIdx !== s.turno) return socket.emit('erro', "Não é a sua vez!");
        
        const j = s.jogadores[jIdx];
        if (temPecaQueServe(j.mao, s.mesa)) return socket.emit('erro', "Você já tem uma peça que serve na mesa!");

        j.mao.push(s.monte.pop());
        socket.emit('atualizarMao', j.mao);
        io.to(minhaSala).emit('atualizarMonte', s.monte.length);
        io.to(minhaSala).emit('atualizarJogadores', s.jogadores.map(p => ({ nome: p.nome, pecas: p.mao.length })));
    });

    socket.on('passarVez', () => {
        const s = salas[minhaSala];
        if (!s || !s.rodando) return;
        
        const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
        if (jIdx !== s.turno) return socket.emit('erro', "Não é a sua vez!");

        if (temPecaQueServe(s.jogadores[jIdx].mao, s.mesa)) return socket.emit('erro', "Você tem peça para jogar!");
        if (s.monte.length > 0) return socket.emit('erro', "Ainda há peças no monte para comprar!");

        s.passesConsecutivos++;

        // NOVA REGRA: CONDIÇÃO DE VITÓRIA POR JOGO TRANCADO
        if (s.passesConsecutivos >= s.jogadores.length) {
            let msgTrancado = "";
            
            // Regra para 4 jogadores (Duplas)
            if (s.jogadores.length === 4) {
                let ptsEq1 = calcularPontos(s.jogadores[0].mao) + calcularPontos(s.jogadores[2].mao);
                let ptsEq2 = calcularPontos(s.jogadores[1].mao) + calcularPontos(s.jogadores[3].mao);
                
                if (ptsEq1 < ptsEq2) msgTrancado = `Equipe 1 venceu por pontos (${ptsEq1} a ${ptsEq2}).`;
                else if (ptsEq2 < ptsEq1) msgTrancado = `Equipe 2 venceu por pontos (${ptsEq2} a ${ptsEq1}).`;
                else msgTrancado = `Empate incrível! Ambas as equipes com ${ptsEq1} pontos!`;
            } 
            // Regra para 2 ou 3 jogadores (Individual)
            else {
                let menorPonto = Infinity;
                let vencedores = [];
                s.jogadores.forEach(jog => {
                    let pts = calcularPontos(jog.mao);
                    if (pts < menorPonto) { 
                        menorPonto = pts; 
                        vencedores = [jog.nome]; 
                    } else if (pts === menorPonto) { 
                        vencedores.push(jog.nome); 
                    }
                });
                msgTrancado = `${vencedores.join(' e ')} venceu com ${menorPonto} pontos!`;
            }

            return finalizarJogo(minhaSala, "🔒 JOGO TRANCADO", msgTrancado);
        }

        s.turno = (s.turno + 1) % s.jogadores.length;
        io.to(minhaSala).emit('atualizarTurno', s.turno);
    });

    socket.on('disconnect', () => {
        if (minhaSala && salas[minhaSala]) {
            salas[minhaSala].jogadores = salas[minhaSala].jogadores.filter(p => p.id !== socket.id);
            if (salas[minhaSala].jogadores.length === 0) {
                delete salas[minhaSala];
            } else {
                io.to(minhaSala).emit('estadoLobby', { rodando: salas[minhaSala].rodando, jogadoresInfo: salas[minhaSala].jogadores });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
