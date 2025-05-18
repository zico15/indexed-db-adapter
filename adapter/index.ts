

export interface ISyncData {
	table: string;
	items: any[];
}


export abstract class IndexedDBSyncAdapter {

	readonly options: { [key: string]: any };

	constructor(options: { [key: string]: any }) {
		this.options = { ...options };
		console.log("IndexedDBSyncAdapter", this.options);
	}

	inizialize(): Promise<boolean> {
		return new Promise<boolean>((resolve) => { resolve(true); });
	}

	abstract synchronize(data: ISyncData): Promise<ISyncData>;
}

export class RESTSyncAdapter extends IndexedDBSyncAdapter {


	synchronize(data: ISyncData): Promise<ISyncData> {
		return new Promise<ISyncData>((resolve, reject) => {
			const url = "http://localhost:3000/api/sync";
			fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(data),
			})
				.then((response) => response.json())
				.then((data) => {
					console.log("Success:", data);
					resolve(data);
				})
				.catch((error) => {
					console.error("Error:", error);
					reject(undefined);
				});
		});
	}

}


export class WebSocketSyncAdapter extends IndexedDBSyncAdapter {
	#socket!: WebSocket;
	private eventOnce: Map<string, Function> = new Map();


	inizialize(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.#socket = new WebSocket("ws://localhost:3000");
			this.#socket.onopen = () => {
				console.log("🔌 Conexão estabelecida");
				resolve(true);
			};

			this.#socket.onmessage = (e) => {
				const data: ISyncData = JSON.parse(e.data);
				console.log("🔌 Mensagem recebida:", data);
				this.eventOnce.get(data.table)?.(data);
				this.eventOnce.delete(data.table);
				console.log(e.data);
			};

			this.#socket.onclose = () => {
				console.log("🔌 Conexão encerrada");
			};

			this.#socket.onerror = (error) => {
				console.error("WebSocket error:", error);
				resolve(false);
			};
		});
	}

	get socket() {
		return this.#socket;
	}





	synchronize(data: ISyncData): Promise<ISyncData> {
		return new Promise<ISyncData>((resolve, reject) => {
			if (this.#socket.readyState === WebSocket.OPEN) {
				this.eventOnce.set(data.table, (result: ISyncData) => {
					resolve(result);
				})
				this.#socket.send(JSON.stringify(data));
			} else {
				console.error("WebSocket is not open. Unable to send data.");
				reject(undefined);
			}
		});
	}
}