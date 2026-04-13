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
    players: User[];
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

const TURN_ORDER = ['RED', 'GREEN', 'YELLOW', 'BLUE'];


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

    private getNextTurn(currentTurn: string): string {
        const currentIndex = TURN_ORDER.indexOf(currentTurn);
        const nextIndex = (currentIndex+1) % 4;
        return TURN_ORDER[nextIndex] || 'RED';
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
        if(this.waitingQueue.length >= 4) {
            const matchedPlayers = this.waitingQueue.splice(0,4);
            const roomId = this.generateRoomId();

            matchedPlayers.forEach((player, index) => {
                const assignedColor = TURN_ORDER[index] || 'RED';
                player.color = assignedColor;
                player.tokens = this.generateStartingTokens(assignedColor);
                this.playerRooms.set(player.socket, roomId);
            })

            const newRoom: Room = {roomId, players: matchedPlayers, turn: 'RED' };
            this.activeRooms.set(roomId, newRoom); 

            const allTokens = matchedPlayers.map(p => ({
                color: p.color,
                tokens: p.tokens,
            }));

            //broadcast 
            matchedPlayers.forEach(player => {
                player.socket.send(JSON.stringify({
                    type: 'game-start',
                    roomId: roomId,
                    color: player.color,
                    allPlayers: allTokens, 
                }));
            });
    }
    }

    private handlePlayerLeave(socket: WebSocket, isSurrender: boolean) {
        //remove from waiting queue
        this.waitingQueue = this.waitingQueue.filter(user => user.socket !== socket);

        const roomId = this.playerRooms.get(socket);
        if(!roomId) return;

        const room = this.activeRooms.get(roomId);
        if(!room) return;

        const leaver = room.players.find(p => p.socket === socket);
        if(!leaver) return;
        
        console.log(`${leaver.name} left the match!`);

        const reason = isSurrender ? 'opponent-surrenderd' : 'opponent-disconnected';

        room.players.forEach(player => {
            if(player.socket !== socket) {
                player.socket.send(JSON.stringify({
                    type: 'game-over',
                    reason: reason,
                    message: `${leaver.name} has left the match, You win!`
                }));
            }

            this.playerRooms.delete(player.socket);
        })

        //deleting the room to prevent memory leaks
        this.activeRooms.delete(roomId);
    }

    public rollDice(socket: WebSocket) {
        //find the room of player
        const roomId = this.playerRooms.get(socket);
        if(!roomId) return;

        //roomdata
        const room = this.activeRooms.get(roomId);
        if(!room) return;

        const player = room.players.find(player => player.socket === socket);
        if(!player) return;
        
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

        room.players.forEach(p => p.socket.send(rollMsg));

        //checking tokens for turn
        const hasActiveTokens = player.tokens?.some(t => t.state === 'ACTIVE');

        if(!hasActiveTokens && diceVal !== 6) {
            room.lastRoll = undefined;
            room.turn = this.getNextTurn(room.turn);
            //skipping turn
            const skipMsg = JSON.stringify({
                type: 'turn-skipped',
                turn: room.turn,
                message: `${player.name} has no valid moves, passing turn to ${room.turn}`
            });

            room.players.forEach(p => p.socket.send(skipMsg));
        }       
    }

    public moveToken(socket: WebSocket, tokenId: string) {
        const roomId = this.playerRooms.get(socket);
        if(!roomId) return;

        const room = this.activeRooms.get(roomId);
        if(!room) return;

        const player = room.players.find(p => p.socket === socket);
        if(!player) return;

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

                    for(const opponent of room.players) {
                        if(opponent === player) continue;

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
        }

        console.log(`${player.name} moved ${tokenId} to ${token.position}`);

        const getExtraTurns = (roll === 6 || room.lastRoll === 6);
        //clear roll and switch turn
        room.lastRoll = undefined;

        // Swapping turns if they do not get an extra turn
        if(!getExtraTurns) {
            room.turn = this.getNextTurn(room.turn);
        }

        const updateMsg = JSON.stringify({
            type: 'board-update',
            turn: room.turn,
            playersState: room.players.map(p => ({color: p.color, tokens: p.tokens}))
        });

        room.players.forEach(p => p.socket.send(updateMsg));     
    }
    public removePlayer (socket: WebSocket) {
        this.handlePlayerLeave(socket, false);     
    }

    public surrenderPlayer(socket: WebSocket) {
        this.handlePlayerLeave(socket, true);
    }
}