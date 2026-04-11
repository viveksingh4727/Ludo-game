import WebSocket from "ws";

interface User {
    name: string,
    socket: WebSocket
}

interface Room {
    roomId: string,
    player1: User,
    player2: User,
    //boardState
}

export class RoomManager {

    //queue for players waiting for match
    private waitingQueue: User[] = [];
    //dicitionary of all active games mapped by their roomID
    private activeRooms: Map<string, Room> = new Map();

    private generateRoomId () {
        return 'room_' + Math.random().toString(36).substring(2, 8);
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
        if(this.waitingQueue.length > 2) {
            //pulling the first 2 player out of queue
            const player1 = this.waitingQueue.shift()!;
            const player2 = this.waitingQueue.shift()!;

            const roomId = this.generateRoomId();

            const newRoom: Room = {roomId, player1, player2};
            this.activeRooms.set(roomId, newRoom); 

            player1.socket.send(JSON.stringify({
                type: "game-start"
            })
        }
     }
}