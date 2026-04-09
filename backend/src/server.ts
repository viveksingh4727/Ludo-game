import express, {Request, Response} from "express";
import http from "node:http";
import WebSocket, {WebSocketServer} from "ws";
import cors from "cors";


const app = express();
app.use(cors());

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    console.log(`New client connected from ${req.socket.remoteAddress}`);

    ws.on('message', (message: WebSocket.RawData) => {
        try {
            const parsedMessage = JSON.parse(message.toString());
            console.log(`Received ${message}`);

            ws.send(JSON.stringify({type: "ACK", message: "Message received"}))
        } catch (error) {
            console.error("Invalid json received", message.toString());
        }
    });

    wss.on('close', () => {
        console.log("Client disconnect");
    });

});

app.get("/health", (req: Request, res: Response) => {
    res.send("Server is running");
});

const PORT = 7000;
app.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
})

