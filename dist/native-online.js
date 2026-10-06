const MAX_ROOM_PLAYERS = 4;
const PLAYER_NAME_KEY = 'garrison-online-player-name';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

export function defaultOnlineServerUrl() {
  return 'wss://garrison-protocol-online.1226631013.workers.dev/ws';
}

export function normalizeOnlineServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return defaultOnlineServerUrl();
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  const url = new URL(/^(wss?|https?):\/\//i.test(raw) ? raw : `${secure ? 'wss' : 'ws'}://${raw}`);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('服务地址需要使用 ws:// 或 wss://。');
  if (url.pathname === '/' || !url.pathname) url.pathname = '/ws';
  if (url.pathname !== '/ws') throw new Error('信令服务地址路径应为 /ws。');
  url.hash = '';
  return url.toString();
}

function localPlayerName() {
  try { return localStorage.getItem(PLAYER_NAME_KEY) || '玩家'; } catch { return '玩家'; }
}

function savePlayerName(value) {
  const name = [...String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 24).join('') || '玩家';
  try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch {}
  return name;
}

export class OnlineRoomClient {
  constructor({url, sessionToken = null, onChange = () => {}, onPeerMessage = () => {}, onCoopEvent = () => {}, onNotice = () => {}} = {}) {
    this.url = normalizeOnlineServerUrl(url);
    this.sessionToken = sessionToken;
    this.onChange = onChange;
    this.onPeerMessage = onPeerMessage;
    this.onCoopEvent = onCoopEvent;
    this.onNotice = onNotice;
    this.socket = null;
    this.pendingCommand = null;
    this.peerConnections = new Map();
    this.peerIceQueues = new Map();
    this.state = {connection: 'idle', room: null, player: null, peers: {}, coop: null, error: null, notice: null};
  }

  snapshot() {
    return structuredClone(this.state);
  }

  dispose() {
    this.#closePeers();
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(1000, 'client replaced'); } catch {}
  }

  #changed() {
    this.onChange(this.snapshot());
  }

  connect() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) return;
    if (typeof WebSocket === 'undefined') {
      this.state.connection = 'error';
      this.state.error = '当前浏览器不支持 WebSocket。';
      this.#changed();
      return;
    }
    this.state.connection = 'connecting';
    this.state.error = null;
    this.#changed();
    let socket;
    try { socket = new WebSocket(this.url); }
    catch (error) {
      this.state.connection = 'error';
      this.state.error = error.message || '无法创建信令连接。';
      this.#changed();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.state.connection = 'connected';
      this.state.error = null;
      const command = this.pendingCommand;
      this.pendingCommand = null;
      if (this.sessionToken) this.#send('room.rejoin', {sessionToken: this.sessionToken});
      else if (command) this.#send(command.type, command.payload);
      this.#changed();
    });
    socket.addEventListener('message', event => this.#handleMessage(event.data));
    socket.addEventListener('error', () => {
      this.state.error = '无法连接信令服务，请检查服务地址、端口与 Origin 配置。';
      this.#changed();
    });
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.state.connection = 'disconnected';
      if (event.code !== 1000 && event.code !== 1001) this.state.error ||= `信令连接已断开（${event.code}）。`;
      this.#changed();
    });
  }

  createRoom({playerName, modeId, allowUnderfilledStart = true} = {}) {
    this.state.error = null;
    const payload = {playerName: savePlayerName(playerName), modeId, allowUnderfilledStart};
    this.#queueOrSend('room.create', payload);
  }

  joinRoom(code, playerName) {
    this.state.error = null;
    this.#queueOrSend('room.join', {code: String(code || '').trim().toUpperCase(), playerName: savePlayerName(playerName)});
  }

  #queueOrSend(type, payload) {
    if (this.socket?.readyState === WebSocket.OPEN && !this.sessionToken) this.#send(type, payload);
    else {
      if (this.sessionToken) this.state.error = '当前客户端仍持有房间成员票据，请先离开原房间。';
      else this.pendingCommand = {type, payload};
      this.connect();
    }
    this.#changed();
  }

  setReady(ready) { return this.#send('room.ready', {ready}); }
  setSettings(settings) { return this.#send('room.set-settings', settings); }
  start(mapId = 'random') { return this.#send('room.start', {mapId}); }
  reportBattle(result) { return this.#send('coop.battle.report', result); }
  reportJointDefense(result) { return this.#send('coop.joint-defense.report', result); }
  readyNextRound(round) { return this.#send('coop.round.ready', {round}); }
  skipBoss(round) { return this.#send('coop.boss.skip', {round}); }

  leave() {
    if (!this.#send('room.leave', {})) this.#clearRoom();
  }

  #send(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.state.error = '信令服务未连接。';
      if (this.sessionToken) this.connect();
      this.#changed();
      return false;
    }
    this.socket.send(JSON.stringify({type, payload}));
    return true;
  }

  sendPeerMessage(message, targetPlayerId = null) {
    let sent = 0;
    for (const [playerId, entry] of this.peerConnections) {
      if (targetPlayerId && playerId !== targetPlayerId) continue;
      if (entry.channel?.readyState !== 'open') continue;
      try {
        const payload = JSON.stringify(message);
        if (payload.length > 48 * 1024) continue;
        entry.channel.send(payload);
        sent += 1;
      } catch {}
    }
    return sent > 0;
  }

  #handleMessage(raw) {
    let message;
    try { message = JSON.parse(raw); }
    catch { return; }
    switch (message.type) {
      case 'room.created':
      case 'room.joined':
      case 'room.rejoined':
      case 'matchmaking.matched':
        this.state.room = message.room;
        this.state.player = message.player;
        if (message.sessionToken) {
          this.sessionToken = message.sessionToken;
          try { localStorage.setItem('garrison-online-session', message.sessionToken); } catch {}
        }
        this.state.error = null;
        this.#reconcileRoom();
        break;
      case 'room.state':
        this.state.room = message.room;
        if (this.state.player) {
          const currentPlayer = message.room?.players?.find(player => player.id === this.state.player.id);
          if (currentPlayer) this.state.player = {...this.state.player, ...currentPlayer};
        }
        if (this.state.player && !message.room?.players?.some(player => player.id === this.state.player.id)) this.#clearRoom(false);
        this.#reconcileRoom();
        break;
      case 'room.started':
        this.state.room = message.room;
        this.state.notice = '全员已准备，正在建立点对点连接。';
        this.#reconcileRoom();
        break;
      case 'signal.forward':
        this.#handleSignal(message.fromPlayerId, message.fromName, message.signalType, message.data);
        break;
      case 'coop.progress':
        this.state.coop = {...(this.state.coop || {}), progress: message};
        this.onCoopEvent(message);
        break;
      case 'coop.joint-defense.started':
      case 'coop.round.advance':
      case 'coop.round.begin':
      case 'coop.game.finished':
        this.state.coop = {...(this.state.coop || {}), lastEvent: message};
        this.onCoopEvent(message);
        break;
      case 'room.left':
      case 'room.kicked':
        this.#clearRoom();
        break;
      case 'room.closed':
        this.#clearRoom();
        this.state.notice = '房间已关闭。';
        break;
      case 'request.accepted':
      case 'server.hello':
      case 'signal.sent':
      case 'matchmaking.queued':
        break;
      case 'error':
        this.state.error = message.message || message.code || '服务请求失败。';
        if (message.code === 'INVALID_SESSION') {
          this.sessionToken = null;
          try { localStorage.removeItem('garrison-online-session'); } catch {}
        }
        break;
      default:
        break;
    }
    this.#changed();
  }

  #clearRoom(clearToken = true) {
    this.#closePeers();
    this.state.room = null;
    this.state.player = null;
    this.state.peers = {};
    if (clearToken) {
      this.sessionToken = null;
      try { localStorage.removeItem('garrison-online-session'); } catch {}
    }
  }

  #reconcileRoom() {
    const room = this.state.room;
    if (!room) return;
    const present = new Set((room.players || []).filter(player => player.id !== this.state.player?.id).map(player => player.id));
    for (const playerId of this.peerConnections.keys()) {
      if (!present.has(playerId)) this.#closePeer(playerId);
    }
    this.state.peers = Object.fromEntries((room.players || [])
      .filter(player => player.id !== this.state.player?.id)
      .map(player => [player.id, {
        name: player.name,
        online: player.online,
        connection: this.peerConnections.get(player.id)?.status || 'waiting'
      }]));
    if (room.phase === 'signaling') this.#startPeerConnections();
  }

  #startPeerConnections() {
    const room = this.state.room;
    const localId = this.state.player?.id;
    if (!room || !localId || typeof RTCPeerConnection === 'undefined') {
      if (room && typeof RTCPeerConnection === 'undefined') this.state.error = '当前浏览器不支持 WebRTC，无法建立点对点连接。';
      return;
    }
    for (const player of room.players || []) {
      if (player.id === localId || !player.online || this.peerConnections.has(player.id)) continue;
      const initiator = localId.localeCompare(player.id) < 0;
      this.#createPeer(player, initiator);
    }
  }

  #createPeer(player, initiator) {
    const pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
    const entry = {pc, channel: null, status: 'connecting', pendingIce: []};
    this.peerConnections.set(player.id, entry);
    this.state.peers[player.id] = {name: player.name, online: player.online, connection: 'connecting'};
    const update = () => {
      const connection = entry.channel?.readyState === 'open' ? 'connected' : pc.connectionState;
      entry.status = connection === 'connected' ? 'connected' : connection || 'connecting';
      this.state.peers[player.id] = {name: player.name, online: player.online, connection: entry.status};
      this.#changed();
    };
    pc.onconnectionstatechange = update;
    pc.oniceconnectionstatechange = update;
    pc.onicecandidate = event => {
      if (event.candidate) this.#send('signal.ice', {targetPlayerId: player.id, data: event.candidate.toJSON()});
    };
    pc.ondatachannel = event => this.#bindChannel(player, entry, event.channel);
    if (initiator) {
      this.#bindChannel(player, entry, pc.createDataChannel('garrison-room-v1', {ordered: true}));
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
        this.#send('signal.offer', {targetPlayerId: player.id, data: pc.localDescription.toJSON()});
      }).catch(error => {
        this.state.error = `无法创建点对点连接：${error.message || error}`;
        entry.status = 'failed';
        update();
      });
    }
    update();
  }

  #bindChannel(player, entry, channel) {
    entry.channel = channel;
    channel.onopen = () => {
      entry.status = 'connected';
      this.state.peers[player.id] = {name: player.name, online: true, connection: 'connected'};
      this.sendPeerMessage({type: 'peer.hello', protocolVersion: 1, playerId: this.state.player?.id, playerName: this.state.player?.name});
      this.#changed();
    };
    channel.onclose = () => {
      entry.status = 'disconnected';
      if (this.state.peers[player.id]) this.state.peers[player.id].connection = 'disconnected';
      this.#changed();
    };
    channel.onerror = () => {
      entry.status = 'failed';
      this.#changed();
    };
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 48 * 1024) return;
      try { this.onPeerMessage(player.id, JSON.parse(event.data)); } catch {}
    };
  }

  async #handleSignal(playerId, playerName, signalType, data) {
    const roomPlayer = this.state.room?.players?.find(player => player.id === playerId) || {id: playerId, name: playerName, online: true};
    let entry = this.peerConnections.get(playerId);
    if (!entry) {
      this.#createPeer(roomPlayer, false);
      entry = this.peerConnections.get(playerId);
    }
    if (!entry) return;
    try {
      if (signalType === 'signal.offer') {
        await entry.pc.setRemoteDescription(data);
        for (const candidate of entry.pendingIce.splice(0)) await entry.pc.addIceCandidate(candidate);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        this.#send('signal.answer', {targetPlayerId: playerId, data: entry.pc.localDescription.toJSON()});
      } else if (signalType === 'signal.answer') {
        await entry.pc.setRemoteDescription(data);
        for (const candidate of entry.pendingIce.splice(0)) await entry.pc.addIceCandidate(candidate);
      } else if (signalType === 'signal.ice') {
        if (!data) return;
        const candidate = new RTCIceCandidate(data);
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(candidate);
        else entry.pendingIce.push(candidate);
      }
    } catch (error) {
      this.state.error = `点对点信令处理失败：${error.message || error}`;
      entry.status = 'failed';
      this.#changed();
    }
  }

  #closePeer(playerId) {
    const entry = this.peerConnections.get(playerId);
    if (!entry) return;
    try { entry.channel?.close(); } catch {}
    try { entry.pc.close(); } catch {}
    this.peerConnections.delete(playerId);
    this.peerIceQueues.delete(playerId);
    delete this.state.peers[playerId];
  }

  #closePeers() {
    for (const playerId of [...this.peerConnections.keys()]) this.#closePeer(playerId);
  }
}

const modeName = (data, modeId) => data?.season?.modeDataDict?.[modeId]?.name || modeId;

export function renderOnlinePanel({online = {}, data, esc = escapeHtml, onlineRun = null, hasGame = false} = {}) {
  const escape = esc || escapeHtml;
  const modes = Object.values(data?.season?.modeDataDict || {}).filter(mode => mode.modeType === 'MULTI' && mode.modeDifficulty !== 'TRAINING');
  const room = online.room;
  const player = online.player;
  const connected = online.connection === 'connected';
  const serverUrl = online.serverUrl || defaultOnlineServerUrl();
  const playerName = online.playerName || localPlayerName();
  const connectionText = ({idle: '尚未连接', connecting: '正在连接信令服务', connected: '信令服务已连接', disconnected: '信令服务已断开', error: '连接失败'})[online.connection] || '尚未连接';
  const error = online.error ? `<p class="native-online-error" role="status">${escape(online.error)}</p>` : '';
  const peerRows = room ? (room.players || []).map(member => {
    const self = member.id === player?.id;
    const peer = online.peers?.[member.id];
    const status = self ? (member.online ? '在线' : '离线') : peer?.connection === 'connected' ? '点对点已连接' : peer?.connection === 'failed' ? '连接失败' : member.online ? '正在连接' : '等待上线';
    return `<li><span><b>${escape(member.name)}${self ? '（我）' : ''}</b><small>${member.id === room.hostPlayerId ? '房主' : '成员'} · ${status}</small></span><em class="${member.ready ? 'is-ready' : ''}">${member.ready ? '已准备' : '未准备'}</em></li>`;
  }).join('') : '';
  const allConnected = !!room && room.phase === 'signaling' && (room.players || []).every(member => member.id === player?.id || online.peers?.[member.id]?.connection === 'connected');
  const waiting = room?.phase === 'waiting';
  const inSignaling = room?.phase === 'signaling';
  const host = !!room && room.hostPlayerId === player?.id;
  const readyCount = room?.players?.filter(member => member.ready && member.online).length || 0;
  const minimumWarning = room?.players?.length < 2 ? '至少需要两名玩家才能开始。' : !room?.allowUnderfilledStart && room?.players?.length < MAX_ROOM_PLAYERS ? '房间未满 4 人；请由房主允许不足员开局。' : readyCount < room?.players?.length ? '等待所有成员在线并准备。' : '房间成员已就绪。';
  const modeOptions = modes.map(mode => `<option value="${escape(mode.modeId)}" ${mode.modeId === (waiting ? room.modeId : online.modeId) ? 'selected' : ''}>${escape(mode.name)}</option>`).join('');
  let body;
  if (!room) {
    body = `<label class="native-online-field">玩家昵称<input id="online-player-name" maxlength="24" autocomplete="nickname" value="${escape(playerName)}"></label><label class="native-online-field">信令服务地址<input id="online-server-url" spellcheck="false" value="${escape(serverUrl)}" placeholder="ws://主机地址:5503/ws"></label><label class="native-online-field">联机难度<select id="online-mode">${modeOptions}</select></label><label class="native-online-check"><input id="online-allow-underfilled" type="checkbox" checked><span>允许 2–3 人开局</span></label><div class="native-online-actions"><button class="native-primary" data-act="online-create">创建配对房间</button></div><div class="native-online-join"><label class="native-online-field">输入 6 位配对码<input id="online-room-code" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="例如 A2BCD3"></label><button data-act="online-join">加入房间</button></div><p class="native-online-hint">创建后把配对码发给队友。最多 4 人；开始后会通过点对点数据通道交换联防支援。</p>`;
  } else {
    body = `<div class="native-online-room-code"><span>配对码</span><strong>${escape(room.code)}</strong><button data-act="online-copy">复制</button></div><p class="native-online-room-meta">${escape(modeName(data, room.modeId))} · ${room.players?.length || 0}/${room.maxPlayers || MAX_ROOM_PLAYERS} 人 · ${waiting ? '等待准备' : allConnected ? '点对点连接完成' : '建立点对点连接中'}</p><ul class="native-online-roster">${peerRows}</ul>${waiting && host ? `<div class="native-online-settings"><label class="native-online-field">联机难度<select id="online-room-mode">${modes.map(mode => `<option value="${escape(mode.modeId)}" ${mode.modeId === room.modeId ? 'selected' : ''}>${escape(mode.name)}</option>`).join('')}</select></label><label class="native-online-check"><input id="online-room-underfilled" type="checkbox" ${room.allowUnderfilledStart ? 'checked' : ''}><span>允许 2–3 人开局</span></label><button data-act="online-settings">应用房间设置</button></div>` : ''}${waiting ? `<p class="native-online-hint">${escape(minimumWarning)}</p><div class="native-online-actions"><button data-act="online-ready" class="${player?.ready ? '' : 'native-primary'}">${player?.ready ? '取消准备' : '准备就绪'}</button>${host ? `<button data-act="online-start" ${readyCount < room.players.length || room.players.length < 2 || (!room.allowUnderfilledStart && room.players.length < MAX_ROOM_PLAYERS) ? 'disabled' : ''}>开始联机</button>` : ''}<button data-act="online-leave">离开房间</button></div>` : `<p class="native-online-hint">${allConnected ? '数据通道已建立。每位玩家拥有独立阵地，盟约转让通过点对点通道送达。' : `点对点连接 ${Object.values(online.peers || {}).filter(peer => peer.connection === 'connected').length}/${Math.max(0, (room.players?.length || 1) - 1)}。跨运营商或严格 NAT 环境需要 TURN；当前 MVP 尚未接入 TURN。`}</p><div class="native-online-actions">${allConnected ? `<button class="native-primary" data-act="online-enter">${hasGame && onlineRun ? '继续联机对局' : '进入联机对局'}</button>` : ''}<button data-act="online-leave">离开房间</button></div>`}`;
  }
  return `<section class="native-home-card native-online-card"><div class="native-card-heading"><div><span class="native-eyebrow">CO-OP / PAIRING CODE</span><h2>联机协作</h2></div><span class="native-card-index">03</span></div><p class="native-online-status"><i class="${connected ? 'is-online' : ''}"></i>${escape(connectionText)}${online.notice ? ` · ${escape(online.notice)}` : ''}</p>${error}${body}</section>`;
}
