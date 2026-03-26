const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// NOVA CONFIGURAÇÃO DE CORS: Permite que o seu site conecte no motor
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Resposta simples para quem acessar o link do Render direto
app.get('/', (req, res) => res.send('🚀 Motor do Dominó Ativo e Rodando!'));

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

let jogadores = []; // Guarda: { id, nome, pronto }
let maos = {}; 
let mesa = [];
let monte = [];
let turnoAtual = 0;
let jogoRodando = false;

function atualizarLobby() {
    io.emit('estadoLobby', { 
        rodando: jogoRodando, 
        jogadoresInfo: jogadores.map(j => ({ id: j.id, nome: j.nome, pronto: j.pronto })) 
    });
}

function iniciarJogo() {
    if (jogoRodando) return;
    jogoRodando = true;
    mesa = [];
    turnoAtual = 0;
    
    let pecasEmbaralhadas = criarDominos();

    for (let i = 0; i < jogadores.length; i++) {
        let id = jogadores[i].id;
        maos[id] = pecasEmbaralhadas.splice(0, 7);
        io.to(id).emit('inicioJogo', { 
            minhaMao: maos[id], 
            meuIndice: i,
            listaNomes: jogadores.map(j => j.nome)
        });
    }
    
    monte = pecasEmbaralhadas;
    
    io.emit('atualizarMesa', mesa);
    io.emit('atualizarMonte', monte.length);
    io.emit('mudarTurno', { turno: turnoAtual, nome: jogadores[turnoAtual].nome });
    io.emit('mensagemGeral', 'O jogo começou! Boa sorte.');
    atualizarLobby();
}

io.on('connection', (socket) => {
    
    socket.on('entrarLobby', (apelido) => {
        if (jogadores.length < 4 && !jogoRodando) {
            jogadores.push({ id: socket.id, nome: apelido, pronto: false });
            io.emit('mensagemGeral', `${apelido} entrou na sala!`);
            atualizarLobby();
            
            if (jogadores.length === 4) iniciarJogo();
        } else {
            socket.emit('erroJogada', 'A sala está cheia ou o jogo já começou!');
        }
    });

    socket.on('marcarPronto', () => {
        let jogador = jogadores.find(j => j.id === socket.id);
        if (jogador) {
            jogador.pronto = true;
            atualizarLobby();

            if (jogadores.length >= 2 && jogadores.every(j => j.pronto)) {
                iniciarJogo();
            }
        }
    });

    socket.on('comprarPeca', () => {
        let jogadorIndice = jogadores.findIndex(j => j.id === socket.id);
        if (jogadorIndice !== turnoAtual) return socket.emit('erroJogada', 'Não é a sua vez!');
        if (monte.length === 0) return socket.emit('erroJogada', 'O monte está vazio!');
        
        let pecaComprada = monte.pop();
        maos[socket.id].push(pecaComprada);
        
        socket.emit('atualizarMao', maos[socket.id]);
        io.emit('atualizarMonte', monte.length);
        io.emit('mensagemGeral', `${jogadores[jogadorIndice].nome} comprou uma peça.`);
    });

    socket.on('jogarPeca', (indexDaPeca) => {
        let jogadorIndice = jogadores.findIndex(j => j.id === socket.id);
        if (jogadorIndice !== turnoAtual) return socket.emit('erroJogada', 'Calma aí! Não é a sua vez.');

        let peca = maos[socket.id][indexDaPeca];
        let jogadaValida = false;

        if (mesa.length === 0) { mesa.push(peca); jogadaValida = true; }
        else {
            let pontaEsquerda = mesa[0][0], pontaDireita = mesa[mesa.length - 1][1];
            if (peca[0] === pontaDireita) { mesa.push([peca[0], peca[1]]); jogadaValida = true; }
            else if (peca[1] === pontaDireita) { mesa.push([peca[1], peca[0]]); jogadaValida = true; }
            else if (peca[1] === pontaEsquerda) { mesa.unshift([peca[0], peca[1]]); jogadaValida = true; }
            else if (peca[0] === pontaEsquerda) { mesa.unshift([peca[1], peca[0]]); jogadaValida = true; }
        }

        if (!jogadaValida) return socket.emit('erroJogada', 'Essa peça não encaixa!');

        maos[socket.id].splice(indexDaPeca, 1);
        socket.emit('atualizarMao', maos[socket.id]); 
        io.emit('atualizarMesa', mesa);

        if (maos[socket.id].length === 0) {
            io.emit('mensagemGeral', `🎉 FIM DE JOGO! ${jogadores[jogadorIndice].nome.toUpperCase()} BATEU E VENCEU! 🎉`);
            jogoRodando = false;
            jogadores.forEach(j => j.pronto = false);
            atualizarLobby();
            return;
        }

        turnoAtual = (turnoAtual + 1) % jogadores.length;
        io.emit('mudarTurno', { turno: turnoAtual, nome: jogadores[turnoAtual].nome });
    });

    socket.on('passarVez', () => {
        let jogadorIndice = jogadores.findIndex(j => j.id === socket.id);
        if (jogadorIndice === turnoAtual) {
            if (monte.length > 0) return socket.emit('erroJogada', 'Ainda há peças no monte! Compre uma.');
            turnoAtual = (turnoAtual + 1) % jogadores.length;
            io.emit('mudarTurno', { turno: turnoAtual, nome: jogadores[turnoAtual].nome });
            io.emit('mensagemGeral', `${jogadores[jogadorIndice].nome} não tinha peça e passou a vez.`);
        }
    });

    socket.on('disconnect', () => {
        let jogadorIndice = jogadores.findIndex(j => j.id === socket.id);
        if (jogadorIndice !== -1) {
            let nomeSaiu = jogadores[jogadorIndice].nome;
            jogadores.splice(jogadorIndice, 1); 
            
            if (jogoRodando) {
                io.emit('mensagemGeral', `🔴 ${nomeSaiu} caiu! A partida foi encerrada.`);
                jogoRodando = false;
                jogadores.forEach(j => j.pronto = false);
            }
            atualizarLobby();

            if (!jogoRodando && jogadores.length >= 2 && jogadores.every(j => j.pronto)) {
                iniciarJogo();
            }
        }
    });
});

// NOVA PORTA: Para não dar erro no Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));