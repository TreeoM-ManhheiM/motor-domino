<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dominó Lógico - Versão Organizada</title>

  <style>
    body {
      margin: 0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #0f172a;
      color: white;
      text-align: center;
      overflow-x: hidden;
    }

    #mesa {
      background: #14532d;
      min-height: 400px;
      border-radius: 20px;
      border: 10px solid #3e2723;
      box-shadow: inset 0 0 50px rgba(0,0,0,0.5);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 8px;
      margin: 20px auto;
      max-width: 95%;
      padding: 30px;
      transition: all 0.3s ease;
    }

    .peca {
      background: #fdf6e3;
      color: #1a1a1a;
      border-radius: 6px;
      font-weight: bold;
      font-size: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 0 #b5ae9a, 0 6px 10px rgba(0,0,0,0.3);
      transition: transform 0.2s;
      user-select: none;
    }
    .peca:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 0 #b5ae9a;
    }
    .p-horiz { width: 70px; height: 35px; flex-direction: row; }
    .p-vert  { width: 35px; height: 70px; flex-direction: column; }
    .valor { flex: 1; display: flex; justify-content: center; align-items: center; }
    .linha { background: #d1d5db; }
    .p-horiz .linha { width: 2px; height: 80%; }
    .p-vert .linha  { width: 80%; height: 2px; }

    #mao {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
      margin: 20px;
      padding: 10px;
      background: rgba(255,255,255,0.05);
      border-radius: 15px;
    }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      font-size: 16px;
      box-shadow: 0 4px #1d4ed8;
    }
    button:active {
      transform: translateY(2px);
      box-shadow: 0 2px #1d4ed8;
    }
    button:disabled {
      background: #64748b;
      box-shadow: none;
      cursor: not-allowed;
    }

    #modal-escolha {
      display: none;
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.85);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    .modal-box {
      background: #1e293b;
      padding: 30px;
      border-radius: 20px;
      border: 3px solid #3b82f6;
      box-shadow: 0 0 30px rgba(59, 130, 246, 0.5);
    }
    .btn-escolha { margin: 10px; padding: 20px 40px; font-size: 20px; }

    /* PRIVACIDADE: BORRÃO NA MÃO */
    #mao.mao-borrada .peca {
      filter: blur(10px);
      transition: filter 0.15s ease;
      opacity: 0.85;
      pointer-events: none;
    }

    #dica-privacidade {
      font-size: 13px;
      opacity: 0.85;
      margin-top: -5px;
      margin-bottom: 10px;
    }

    /* Status de conexão */
    #status-conexao {
      font-size: 1.2em;
      margin: 15px 0;
      padding: 10px 25px;
      border-radius: 8px;
      background: rgba(255,255,255,0.1);
      display: inline-block;
    }
  </style>
</head>

<body>
  <div id="modal-escolha">
    <div class="modal-box">
      <h2 style="margin-bottom: 25px;">Escolha o lado da jogada</h2>
      <button class="btn-escolha" style="background: #10b981;" onclick="window.confirmarJogada('esq')">⬅️ ESQUERDA</button>
      <button class="btn-escolha" style="background: #3b82f6;" onclick="window.confirmarJogada('dir')">DIREITA ➡️</button>
    </div>
  </div>

  <div id="lobby">
    <h1 style="color: #60a5fa;">Dominó Lógico 🧠</h1>

    <!-- Indicador de conexão -->
    <div id="status-conexao">🔄 Conectando ao servidor...</div>

    <div id="controles-login">
      <input type="text" id="nick" placeholder="Seu Nome" disabled
             style="padding: 12px; border-radius: 8px; border: none; margin: 5px;" />
      <input type="text" id="sala" placeholder="Nome da Sala" disabled
             style="padding: 12px; border-radius: 8px; border: none; margin: 5px;" />
      <button onclick="window.entrar()" disabled>ENTRAR NO JOGO</button>
    </div>

    <div id="espera" style="display:none">
      <h3>Jogadores na Sala:</h3>
      <ul id="lista" style="list-style: none; padding: 0; font-size: 1.2em;"></ul>
      <button id="btnIni" onclick="window.clicarPronto()" disabled>ESTOU PRONTO!</button>
    </div>
  </div>

  <div id="jogo" style="display:none">
    <div style="background: rgba(0,0,0,0.3); padding: 10px; font-size: 1.2em; font-weight: bold;" id="turno">
      Aguardando...
    </div>

    <div id="mesa"></div>

    <div id="dica-privacidade">Dica: esconda suas peças quando não for sua vez 👀</div>

    <div id="mao"></div>

    <div style="margin-bottom: 30px;">
      <button onclick="socket.emit('comprarPeca')" style="background: #f59e0b; box-shadow: 0 4px #b45309;">
        COMPRAR
      </button>

      <button onclick="socket.emit('passarVez')" style="background: #ef4444; box-shadow: 0 4px #b91c1c;">
        PASSAR VEZ
      </button>

      <button id="btnPrivacidade"
              onclick="window.togglePrivacidade()"
              style="background:#64748b; box-shadow:0 4px #334155; margin-left:10px;">
        👁️ Mostrar Peças
      </button>
    </div>
  </div>

  <script src="https://cdn.socket.io/4.8.3/socket.io.min.js"></script>
  <script>
    // Conexão otimizada para cold start do Render
    const socket = io({
      transports: ["polling", "websocket"],  // polling primeiro para acordar o servidor
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 30000
    });

    // Elementos do status
    const statusEl = document.getElementById('status-conexao');
    const inputs = document.querySelectorAll('#controles-login input');
    const btnEntrar = document.querySelector('#controles-login button');

    socket.on('connect', () => {
      statusEl.innerHTML = '✅ Conectado ao servidor';
      statusEl.style.background = 'rgba(16, 185, 129, 0.2)';
      inputs.forEach(i => i.disabled = false);
      btnEntrar.disabled = false;
    });

    socket.on('disconnect', () => {
      statusEl.innerHTML = '❌ Conexão perdida. Reconectando...';
      statusEl.style.background = 'rgba(239, 68, 68, 0.2)';
      inputs.forEach(i => i.disabled = true);
      btnEntrar.disabled = true;
    });

    socket.on('reconnect_attempt', (attempt) => {
      statusEl.innerHTML = `🔄 Aguardando servidor acordar... (tentativa ${attempt})`;
      statusEl.style.background = 'rgba(251, 191, 36, 0.2)';
    });

    socket.on('connect_error', () => {
      statusEl.innerHTML = '🔄 Aguardando servidor (Render cold start)...';
      statusEl.style.background = 'rgba(251, 191, 36, 0.2)';
    });

    // ===== LÓGICA DO JOGO =====
    let meuNome = "", mesaAtu = [], maoAtu = [], jogadaPendente = null;
    let maoBorrada = true;

    function aplicarPrivacidade() {
      const maoEl = document.getElementById('mao');
      const btn = document.getElementById('btnPrivacidade');
      if (!maoEl) return;

      if (maoBorrada) {
        maoEl.classList.add('mao-borrada');
        if (btn) btn.innerText = "👁️ Mostrar Peças";
      } else {
        maoEl.classList.remove('mao-borrada');
        if (btn) btn.innerText = "🔒 Esconder Peças";
      }
    }

    window.togglePrivacidade = () => {
      maoBorrada = !maoBorrada;
      aplicarPrivacidade();
    };

    window.entrar = () => {
      meuNome = document.getElementById('nick').value;
      if (!meuNome) return alert("Digite seu nome!");

      socket.emit('entrarSala', {
        apelido: meuNome,
        sala: document.getElementById('sala').value || "Geral"
      });

      document.getElementById('controles-login').style.display = 'none';
    };

    window.clicarPronto = () => {
      socket.emit('marcarPronto');
      document.getElementById('btnIni').innerText = "AGUARDANDO...";
      document.getElementById('btnIni').disabled = true;
    };

    window.jogar = (idx) => {
      if (maoBorrada) return;

      const p = maoAtu[idx];
      if (mesaAtu.length === 0) return socket.emit('jogarPeca', { index: idx, lado: 'dir' });

      const e = mesaAtu[0][0];
      const d = mesaAtu[mesaAtu.length - 1][1];
      const serveEsq = (p[0] === e || p[1] === e);
      const serveDir = (p[0] === d || p[1] === d);

      if (serveEsq && serveDir && e !== d) {
        jogadaPendente = idx;
        document.getElementById('modal-escolha').style.display = 'flex';
      } else if (serveEsq) {
        socket.emit('jogarPeca', { index: idx, lado: 'esq' });
      } else if (serveDir) {
        socket.emit('jogarPeca', { index: idx, lado: 'dir' });
      } else {
        alert("Essa peça não encaixa em nenhuma das pontas!");
      }
    };

    window.confirmarJogada = (lado) => {
      socket.emit('jogarPeca', { index: jogadaPendente, lado: lado });
      document.getElementById('modal-escolha').style.display = 'none';
    };

    socket.on('estadoLobby', d => {
      document.getElementById('espera').style.display = 'block';
      document.getElementById('lista').innerHTML = d.jogadoresInfo
        .map(j => `<li>${j.pronto ? '✅' : '⏳'} ${j.nome}</li>`)
        .join('');

      if (d.jogadoresInfo.length >= 2) document.getElementById('btnIni').disabled = false;
    });

    socket.on('jogoIniciado', () => {
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('jogo').style.display = 'block';
      maoBorrada = true;
      aplicarPrivacidade();
    });

    socket.on('atualizarMesa', m => {
      mesaAtu = m;
      document.getElementById('mesa').innerHTML = m.map(p => `
        <div class="peca ${p[0] === p[1] ? 'p-vert' : 'p-horiz'}">
          <div class="valor">${p[0]}</div>
          <div class="linha"></div>
          <div class="valor">${p[1]}</div>
        </div>`).join('');
    });

    socket.on('atualizarMao', m => {
      maoAtu = m;
      document.getElementById('mao').innerHTML = m.map((p, i) => `
        <div class="peca ${p[0] === p[1] ? 'p-vert' : 'p-horiz'}" onclick="window.jogar(${i})">
          <div class="valor">${p[0]}</div>
          <div class="linha"></div>
          <div class="valor">${p[1]}</div>
        </div>`).join('');

      aplicarPrivacidade();
    });

    socket.on('mudarTurno', d => {
      const t = document.getElementById('turno');
      t.innerText = d.nome === meuNome ? "⭐ SUA VEZ DE JOGAR! ⭐" : "Vez de: " + d.nome;
      t.style.color = d.nome === meuNome ? "#fbbf24" : "white";
    });

    socket.on('mensagemGeral', m => alert(m));
    socket.on('resetJogo', () => setTimeout(() => location.reload(), 3000));
    socket.on('erro', e => alert(e));
  </script>
</body>
</html>
