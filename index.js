export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Matches /room/<room_code>
    const match = url.pathname.match(/^\/room\/([A-Za-z0-9_-]+)$/);
    if (!match) {
      return new Response("LastWave Group Listen Server Running", { status: 200 });
    }

    const roomId = match[1];
    const id = env.ROOM_DO.idFromName(roomId);
    const roomObject = env.ROOM_DO.get(id);

    return roomObject.fetch(request);
  }
};

export class MusicRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Set();
    this.playbackState = {
      songId: null,
      isPlaying: false,
      timestamp: 0,
      updatedAt: Date.now()
    };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket connection", { status: 426 });
    }

    // Limit room capacity to 10 users
    if (this.sessions.size >= 10) {
      return new Response("Room is full", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);

    // Send current playback state to the newly connected user
    webSocket.send(JSON.stringify({
      type: "SYNC",
      state: this.playbackState,
      members: this.sessions.size
    }));

    this.broadcast({
      type: "USER_JOINED",
      members: this.sessions.size
    });

    webSocket.addEventListener("message", async (msg) => {
      try {
        const data = JSON.parse(msg.data);

        switch (data.type) {
          case "PLAY":
          case "PAUSE":
          case "SEEK":
          case "CHANGE_SONG":
            this.playbackState = {
              songId: data.songId ?? this.playbackState.songId,
              isPlaying: data.type === "PLAY" ? true : (data.type === "PAUSE" ? false : this.playbackState.isPlaying),
              timestamp: data.timestamp ?? this.playbackState.timestamp,
              updatedAt: Date.now()
            };
            this.broadcast({
              type: data.type,
              state: this.playbackState,
              sender: data.userId
            });
            break;

          default:
            break;
        }
      } catch (err) {
        // Ignore malformed messages
      }
    });

    const closeHandler = () => {
      this.sessions.delete(webSocket);
      this.broadcast({
        type: "USER_LEFT",
        members: this.sessions.size
      });
    };

    webSocket.addEventListener("close", closeHandler);
    webSocket.addEventListener("error", closeHandler);
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const session of this.sessions) {
      try {
        session.send(payload);
      } catch (err) {
        this.sessions.delete(session);
      }
    }
  }
}
