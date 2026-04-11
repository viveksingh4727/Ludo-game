import express, {Request, Response} from "express";
import http from "node:http";
import WebSocket, {WebSocketServer} from "ws";
import cors from "cors";
import { RoomManager } from "./RoomManager";


const app = express();
app.use(cors());

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

const roomManger = new RoomManager();

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    console.log(`New client connected from ${req.socket.remoteAddress}`);

    ws.on('message', (message: WebSocket.RawData) => {
        try {
            const parsed = JSON.parse(message.toString());
            if(parsed.action === 'find-match') {
                const playerName = parsed.playerName;
                roomManger.addPlayer(ws, playerName)
            }
            else if (parsed.action === 'roll-dice') {
                roomManger.rollDice(ws);
            } 
            else if (parsed.action === 'move-token') {
                roomManger.moveToken(ws, parsed.tokenId);
            }
            else if (parsed.action === 'surrender') {
                roomManger.surrenderPlayer(ws)
            }
        } catch (error) {
            console.error("Invalid json received", message.toString());
        }
    });

    ws.on('close', () => {
        console.log("Client disconnect");
        roomManger.removePlayer(ws);
    });

});

app.get("/health", (req: Request, res: Response) => {
    res.send("Server is running");
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
})

