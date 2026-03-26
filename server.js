// ... (resto do código anterior)

    socket.on('marcarPronto', () => {
        const s = salas[minhaSala];
        if (!s) return;
        const j = s.jogadores.find(p => p.id === socket.id);
        if (j) j.pronto = true;

        // Se houver pelo menos 2 e todos estiverem prontos, o jogo DEVE iniciar
        if (s.jogadores.length >= 2 && s.jogadores.every(p => p.pronto)) {
            s.rodando = true;
            s.monte = criarDominos();
            s.mesa = [];
            s.turno = 0;
            s.jogadores.forEach(p => {
                p.mao = s.monte.splice(0, 7);
                // Envia a mão específica para cada ID de socket
                io.to(p.id).emit('atualizarMao', p.mao);
            });
            io.to(minhaSala).emit('inicioJogo', { rodando: true });
            io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
            io.to(minhaSala).emit('atualizarMonte', s.monte.length);
        }
        // Atualiza a lista de quem está na sala para todos
        io.to(minhaSala).emit('estadoLobby', { rodando: s.rodando, jogadoresInfo: s.jogadores });
    });
