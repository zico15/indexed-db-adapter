import { IndexedDBSyncAdapter, ISyncData } from "./adapter";


const auto = Symbol("auto");
const DB_KEY = Symbol("DB_KEY");

//const keyStore = new WeakMap<object, IDBValidKey>();

type Timestamp = number;

export abstract class TableStore {

	updatedAt: Timestamp = Date.now();

	constructor(name: string | Symbol = auto, options: IDBObjectStoreParameters = { autoIncrement: true }) {
		if (!this.constructor.prototype?.tableName) {
			this.constructor.prototype.tableName = name === auto ? this.constructor.name : name;
			this.constructor.prototype.options = options;
		}
	}

	public async save(): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			const { tableName, db, options } = this.constructor.prototype;
			const store: IDBObjectStore = db.transaction(tableName, "readwrite").objectStore(tableName);
			this.updatedAt = Date.now();
			// @ts-ignore
			const addRequest = options?.keyPath ? store.put(this) : store.put(this, this.getKey());
			addRequest.onsuccess = (e: any) => {
				const key = e.target.result;
				// @ts-ignore
				if (this[DB_KEY] == undefined) {
					Object.defineProperty(this, DB_KEY, {
						value: key,
						writable: false,
						enumerable: false,
						configurable: false,
					});
				}
				this.synchronize();
				resolve(true)
			}
			addRequest.onerror = () => reject(false);
		});
	}


	public static async put<T extends typeof TableStore>(this: T, data: InstanceType<T>): Promise<InstanceType<T> | undefined> {
		return new Promise<InstanceType<T> | undefined>((resolve) => {
			const { tableName, db } = this.prototype.constructor.prototype;
			const store: IDBObjectStore = db.transaction(tableName, "readwrite").objectStore(tableName);
			data.updatedAt = Date.now();
			const addRequest = store.put(data);
			addRequest.onsuccess = (e: any) => {
				const key = e.target.result;
				// @ts-ignore
				const resutl: InstanceType<T> = new this.prototype.constructor();
				Object.assign(resutl, data);
				Object.defineProperty(resutl, DB_KEY, {
					value: key,
					writable: false,
					enumerable: false,
					configurable: false,
				});
				resutl.synchronize();
				resolve(resutl)
			};
			addRequest.onerror = () => resolve(undefined);
		});
	}

	getKey(): IDBValidKey {
		// @ts-ignore
		return this[DB_KEY];
	}


	public static async get<T extends typeof TableStore>(this: T, key: IDBValidKey): Promise<InstanceType<T> | undefined> {
		return new Promise<InstanceType<T> | undefined>((resolve) => {
			const { tableName, db } = this.prototype.constructor.prototype;
			const store: IDBObjectStore = db.transaction(tableName, "readwrite").objectStore(tableName);
			// @ts-ignore
			const getRequest = store.get(key);
			getRequest.onsuccess = (e: any) => {
				const data = e.target.result;
				if (data) {
					console.log("data: ", data)
					// @ts-ignore
					const resutl: InstanceType<T> = new this.prototype.constructor();
					Object.assign(resutl, data);
					Object.defineProperty(resutl, DB_KEY, {
						value: key,
						writable: false,
						enumerable: false,
						configurable: false,
					});
					resolve(resutl)
				}
				else resolve(undefined);
			};
			getRequest.onerror = () => resolve(undefined);
		});
	}

	async synchronize(): Promise<boolean> {
		if (!this.constructor.prototype.db || this.constructor.prototype.db.synchronize == false) {
			return true
		}
		return await this.constructor.prototype.db.synchronizeTableItem(this);
	}

	public static async synchronizeTable(socket: WebSocket) {
		return new Promise<boolean>((resolve) => {
			setTimeout(() => {
				//console.log("synchronizeTable: ", this.prototype.constructor.prototype.tableName, " socket: ", socket);
				resolve(true);
			}, Math.random() * 2000);
		});
	}

	public static async getUnsynced<T extends typeof TableStore>(this: T): Promise<InstanceType<T>[]> {
		return new Promise<InstanceType<T>[]>((resolve) => {
			const { tableName, db } = this.prototype.constructor.prototype;
			const store: IDBObjectStore = db.transaction(tableName, "readwrite").objectStore(tableName);
			const getRequest = store.getAll();
			getRequest.onsuccess = (e: any) => {
				const data = e.target.result;
				if (data) {
					const result: InstanceType<T>[] = [];
					for (const item of data) {
						// @ts-ignore
						const resutl: InstanceType<T> = new this.prototype.constructor();
						Object.assign(resutl, item);
						result.push(resutl);
					}
					resolve(result)
				}
				else resolve([]);
			};
			getRequest.onerror = () => resolve([]);
		});
	}
}


export class DataBase {

	#request!: IDBOpenDBRequest;
	#eventOnce: Function[] = [];
	readonly name: string;
	readonly syncAdapter: IndexedDBSyncAdapter | undefined;
	#db: IDBDatabase | undefined;
	version?: number;
	isListen: boolean = false;
	tables = new Map<string, any>;
	readonly options: { version: number, syncAdapter?: typeof IndexedDBSyncAdapter, debug?: boolean };

	constructor(name: string, options?: { version?: number, syncAdapter?: typeof IndexedDBSyncAdapter, debug?: boolean }) {
		this.name = name;
		this.options = { ...options, version: options?.version || 1 };
		this.version = options?.version;
		if (this.options.syncAdapter) {
			// @ts-ignore
			this.syncAdapter = new this.options.syncAdapter({});
			window.addEventListener("online", () => { this.synchronize() });
		}
	}

	get online() {
		return navigator?.onLine || false;
	}

	get request() {
		if (!this.#request) {
			throw new Error("Database not opened");
		}
		return this.#request;
	}

	get db() {
		if (!this.#db) {
			throw new Error("Database not opened");
		}
		return this.#db;
	}

	async listen(onsuccess?: Function) {
		if (this.syncAdapter)
			await this.syncAdapter.inizialize();
		if (this.options.debug) indexedDB.deleteDatabase(this.name);
		this.#request = indexedDB.open(this.name, this.version);
		this.#request.onupgradeneeded = async (e: any) => {
			const db: IDBDatabase = e.target.result;
			this.#db = db;
			for await (const event of this.#eventOnce) {
				event(db);
			}
			this.#eventOnce = [];
		}
		this.#request.onsuccess = (e: any) => { this.#onsuccess(e.target.result); if (onsuccess) onsuccess(); }
	}

	async #onsuccess(db: IDBDatabase) {
		console.log("onsuccess", db);
		// @ts-ignore
		db["synchronize"] = this.options.synchronize;
		// @ts-ignore
		db["synchronizeTableItem"] = this.synchronizeTableItem.bind(this);
		for (const [_, value] of this.tables) {
			value.constructor.prototype.db = db;
		}
		this.isListen = true;
		if (this.options.syncAdapter) {
			this.synchronize();
			window.addEventListener("online", () => {
				console.log("online");
			});
			window.addEventListener("offline", () => {
				console.log("offline");
			});
		}
	};

	addTable<T extends typeof TableStore>(table: T | any): void {
		table = new table();
		this.tables.set(table.constructor.prototype.tableName, table);
		this.#eventOnce.push((db: IDBDatabase) => {
			const options = table.constructor.prototype.options;
			const name = table.constructor.prototype.tableName;
			if (!db.objectStoreNames.contains(name)) {
				db.createObjectStore(name, options || { keyPath: "id" });
			}
		})
	}

	private async synchronizeTableItem<T extends TableStore>(item: T): Promise<boolean> {
		if (this.syncAdapter) {
			this.syncAdapter.synchronize({
				table: item.constructor.prototype.tableName,
				items: [item],
			});
		}
		return true;
	}

	private async synchronizeTable<T extends TableStore>(table: T): Promise<boolean> {
		if (this.syncAdapter) {
			// @ts-ignore
			const items = await table.constructor["getUnsynced"]();
			this.syncAdapter.synchronize({
				table: table.constructor.prototype.tableName,
				items: items,
			}).then((data: ISyncData) => {
				this.merge(data);
				console.log("Success:", data);
			}).catch((error) => {
				console.error("Error:", error);
			});
		}
		return true;
	}

	async synchronize(): Promise<boolean> {
		console.log("synchronize: ", this.tables);
		const promises: Promise<boolean>[] = Array.from(this.tables.values()).map((table: any) => this.synchronizeTable(table));
		return Promise.all(promises).then(() => true).catch(() => false);
	}


	async merge(data: ISyncData): Promise<boolean> {
		const store: IDBObjectStore = this.db.transaction(data.table, "readwrite").objectStore(data.table);
		for (const item of data.items) {
			const addRequest = store.put(item);
			addRequest.onsuccess = (e: any) => { }
			addRequest.onerror = () => console.error("Error:", item);
		}
		return true;
	}


}