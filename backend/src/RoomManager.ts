import WebSocket from "ws";

type TokenState = "YARD" | "ACTIVE" | "HOME";

const SAFE_TILES = [0, 8, 13, 21, 26, 34, 39, 47];

interface Token {
    id: string;
    state: TokenState;
    position: number;
}

interface User {
    name: string;
    socket: WebSocket;
    color?: string;
    tokens?: Token[];
}

interface Room {
    roomId: string;
    player1: User;
    player2: User;
    turn: string;
    lastRoll?: number | undefined;
    //boardState
}

const OFF_SETS: Record<string, number> = {
    'RED': 0,
    'GREEN': 13,
    'YELLOW': 26,
    'BLUE': 39,
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

    private getAbsolutePosition(color: string, relativePosition: number): number{
        //if the token is in yard or in home stretch that is above 51 it is safe

        if(relativePosition < 0 || relativePosition > 50) {
            return -1;
        }

        const offset = OFF_SETS[color] || 0;
        return (relativePosition + offset) % 52;
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

            player1.color = 'RED';
            player1.tokens = this.generateStartingTokens('RED');

            player2.color = 'BLUE',
            player2.tokens = this.generateStartingTokens('BLUE');

            const newRoom: Room = {roomId, player1, player2, turn: 'RED' };
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

    private handlePlayerLeave(socket: WebSocket, isSurrender: boolean) {
        //remove from waiting queue
        this.waitingQueue = this.waitingQueue.filter(user => user.socket !== socket);

        const roomId = this.playerRooms.get(socket);
        if(!roomId) return;

        const room = this.activeRooms.get(roomId);
        if(!room) return;

        const isPlayer1 = room.player1.socket === socket;
        const leaver = isPlayer1 ? room.player1 : room.player2;
        const winner = isPlayer1 ? room.player2 : room.player1;
        
        console.log(`${leaver.name} left the match! ${winner.name} wins the match`);

        const reason = isSurrender ? 'opponent-surrenderd' : 'opponent-disconnected';

        winner.socket.send(JSON.stringify({
            type: 'game-over',
            reason: reason,
            message: `${leaver.name} has left the match, You win!`
        }))

        //deleting the room to prevent memory leaks
        this.activeRooms.delete(roomId);
        this.playerRooms.delete(room.player1.socket);
        this.playerRooms.delete(room.player2.socket);
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
        room.lastRoll = diceVal;
        console.log(`${player.name} (${player.color}) rolled a ${diceVal}`)

        //broadcasting result
        const rollMsg = JSON.stringify({
            type: 'dice-rolled',
            color: player.color,
            value: diceVal,
        });

        room.player1.socket.send(rollMsg);
        room.player2.socket.send(rollMsg);

        //checking tokens for turn
        const hasActiveTokens = player.tokens?.some(t => t.state === 'ACTIVE');

        if(!hasActiveTokens && diceVal !== 6) {
            room.lastRoll = undefined;
            room.turn = room.turn === 'RED' ? 'BLUE' : 'RED';
            //skipping turn
            const skipMsg = JSON.stringify({
                type: 'turn-skipped',
                turn: room.turn,
                message: `${player.name} has no valid moves, passing turn to ${room.turn}`
            });

            room.player1.socket.send(skipMsg);
            room.player2.socket.send(skipMsg);
        }       
    }

    public moveToken(socket: WebSocket, tokenId: string) {
        const roomId = this.playerRooms.get(socket);
        if(!roomId) return;

        const room = this.activeRooms.get(roomId);
        if(!room) return;

        const isPlayer1 = room.player1.socket === socket;
        const player = isPlayer1 ? room.player1 : room.player2

        if(room.turn !== player.color) return;
        if(!room.lastRoll) return; //dice have'nt been rolled
        
        //finding specific token the user want to move
        const token = player.tokens?.find(t => t.id === tokenId);
        if(!token) return;

        const roll = room.lastRoll;

        //movement logic
        if(token.state === 'YARD') {
            if(roll === 6) {
                token.state = 'ACTIVE';
                token.position = 0;
            } else {
                socket.send(JSON.stringify({
                    type: 'error',
                    message: 'you need a 6 to unlock'
                }));
                return;
            }
        }
        else if(token.state === 'ACTIVE') {
            const newPosition = token.position + roll;

            if(newPosition > 57) {
                socket.send(JSON.stringify({
                    type: 'error',
                    message: 'move exceeds the home'
                }));
                return;
            } else if (newPosition === 57) {
                token.state = 'HOME';
                token.position = 57; 
            } else {
                token.position = newPosition;

                //collision logic
                const absolutePos = this.getAbsolutePosition(player.color!, token.position);

                if(absolutePos !== -1 && !SAFE_TILES.includes(absolutePos)) {

                    //find opponent
                    const opponent = isPlayer1 ? room.player2 : room.player1;

                    const eatenToken = opponent.tokens?.
                    find(t => this.getAbsolutePosition(opponent.color!, t.position) === absolutePos);

                    if(eatenToken) {
                        console.log(`${player.name} ate ${opponent.name}: ${eatenToken.id}`);

                        eatenToken.state = 'YARD';
                        eatenToken.position = -1;

                        //eating opponent grant extra turn faking roll to 6
                        room.lastRoll = 6;

                    }

                }
            }
        }

        console.log(`${player.name} moved ${tokenId} to ${token.position}`);

        const getExtraTurns = (roll === 6 || room.lastRoll === 6);
        //clear roll and switch turn
        room.lastRoll = undefined;

        // Swapping turns if they do not get an extra turn
        if(!getExtraTurns) {
            room.turn = room.turn === 'RED' ? 'BLUE' : 'RED';
        }

        const updateMsg = JSON.stringify({
            type: 'board-update',
            turn: room.turn,
            player1Tokens: room.player1.tokens,
            player2Tokens: room.player2.tokens,
        });

        room.player1.socket.send(updateMsg);
        room.player2.socket.send(updateMsg);        
    }
    public removePlayer (socket: WebSocket) {
        this.handlePlayerLeave(socket, false);     
    }

    public surrenderPlayer(socket: WebSocket) {
        this.handlePlayerLeave(socket, true);
    }
}