import WebSocket from "ws";

type TokenState = "YARD" | "ACTIVE" | "HOME";

interface Token {
    id: string,
    state: TokenState,
    position: number,
}

interface User {
    name: string,
    socket: WebSocket,
    color?: string,
    tokens?: Token[];
}

interface Room {
    roomId: string,
    player1: User,
    player2: User,
    turn: string,
    //boardState
}

export class RoomManager {

    //queue for players waiting for match
    private waitingQueue: User[] = [];
    //dicitionary of all active games mapped by their roomID
    private activeRooms: Map<string, Room> = new Map();
    private playerRooms: Map<WebSocket, string> = new Map();

    private generateRoomId () {
        return 'room_' + Math.random().toString(36).substring(2, 8);
    }

    private generateStartingTokens(color: string): Token[] {
        return [1,2,3,4].map(num => ({
            id: `${color.toLowerCase()}_${num}`,
            state: "YARD",
            position: -1,
        }))

    }

    public addPlayer(socket: WebSocket, name: string) {
        const newUser: User = {socket, name};
        this.waitingQueue.push(newUser);

        //notify the player while they are waiting
        socket.send(JSON.stringify({
            type: "wait-for-match",
            message: "Waiting for an opponent"
        }));

        this.startGame();
    }

    private startGame() {
        //check if the 2 players are in queue
        if(this.waitingQueue.length >= 2) {
            //pulling the first 2 player out of queue
            const player1 = this.waitingQueue.shift()!;
            const player2 = this.waitingQueue.shift()!;

            const roomId = this.generateRoomId();

            player1.color = 'RED',
            player1.tokens = this.generateStartingTokens('RED');

            player2.color = 'BLUE',
            player2.tokens = this.generateStartingTokens('BLUE');

            const newRoom: Room = {roomId, player1, player2, turn: 'RED'};
            this.activeRooms.set(roomId, newRoom); 

            this.playerRooms.set(player1.socket, roomId);
            this.playerRooms.set(player2.socket, roomId);

            player1.socket.send(JSON.stringify({
                type: "game-start",
                roomId: roomId,
                color: player1.color,
                tokens: player1.tokens, //tokens to render on frontend
            }));

            player2.socket.send(JSON.stringify({
                type: "game-start",
                roomId: roomId,
                color: player2.color,
                tokens: player2.tokens,
            }));

        }
    }

    public rollDice(socket: WebSocket) {
        //find the room of player
        const roomId = this.playerRooms.get(socket);
        if(!roomId) return;

        //roomdata
        const room = this.activeRooms.get(roomId);
        if(!room) return;

        //check sender player1 or player2
        const isPlayer1 = room.player1.socket === socket;
        const player = isPlayer1 ? room.player1 : room.player2;
        
        //checking for turn
        if(room.turn !== player.color) {
            socket.send(JSON.stringify({
                type: 'error',
                message: 'Not your turn!'
            }));
            return;
        }

        const diceVal = Math.floor(Math.random() * 6)+1;
        console.log(`${player.name} (${player.color}) rolled a ${diceVal}`)

        //broadcasting result
        const rollMsg = JSON.stringify({
            type: 'dice-rolled',
            color: player.color,
            value: diceVal,
        });

        room.player1.socket.send(rollMsg);
        room.player2.socket.send(rollMsg);

    }
    public removePlayer (socket: WebSocket) {

        this.waitingQueue = this.waitingQueue.filter(user => user.socket != socket);        

    }
}