socket.on('jogarPeca', ({ index, lado }) => {
    const s = salas[minhaSala];
    if (!s || !s.rodando) return;
    const jIdx = s.jogadores.findIndex(p => p.id === socket.id);
    if (s.turno !== jIdx) return;

    let jogador = s.jogadores[jIdx];
    let peca = [...jogador.mao[index]];

    // Se o jogador não enviou lado (clique direto), tentamos achar um
    if (!lado) {
        let pEsq = s.mesa.length > 0 ? s.mesa[0][0] : null;
        let pDir = s.mesa.length > 0 ? s.mesa[s.mesa.length - 1][1] : null;

        if (s.mesa.length === 0) lado = 'dir';
        else if (peca[0] === pDir || peca[1] === pDir) lado = 'dir';
        else if (peca[0] === pEsq || peca[1] === pEsq) lado = 'esq';
    }

    // Lógica de encaixe com Giro Automático
    if (s.mesa.length === 0) {
        s.mesa.push(peca);
    } else if (lado === 'esq') {
        let pEsq = s.mesa[0][0];
        if (peca[1] === pEsq) s.mesa.unshift(peca);
        else if (peca[0] === pEsq) s.mesa.unshift(peca.reverse());
    } else {
        let pDir = s.mesa[s.mesa.length - 1][1];
        if (peca[0] === pDir) s.mesa.push(peca);
        else if (peca[1] === pDir) s.mesa.push(peca.reverse());
    }

    jogador.mao.splice(index, 1);
    io.to(minhaSala).emit('atualizarMesa', s.mesa);
    socket.emit('atualizarMao', jogador.mao);
    
    // Passa o turno e verifica vitória...
    s.turno = (s.turno + 1) % s.jogadores.length;
    io.to(minhaSala).emit('mudarTurno', { nome: s.jogadores[s.turno].nome });
});
