import { drizzle } from 'drizzle-orm/d1';
import { rotaTable } from './schema';
import { and, eq } from 'drizzle-orm';
import getRotaNumberForDate from '../getRotaNumberForDate';

export function createDb(database: D1Database) {
	return drizzle(database);
}

export type Db = ReturnType<typeof createDb>;

export async function upsertRota({ chatId, rota, db }: { chatId: number; rota: '1' | '2' | '3' | 'OFFICE_HOURS'; db: Db }) {
	return db
		.insert(rotaTable)
		.values({
			telegramChatId: chatId,
			rota,
		})
		.onConflictDoUpdate({
			target: rotaTable.telegramChatId,
			set: {
				rota,
			},
		});
}

export async function removeSubscription({ chatId, db }: { chatId: number; db: Db }) {
	return db.delete(rotaTable).where(eq(rotaTable.telegramChatId, chatId));
}

export async function getChatIDsForToday({ db }: { db: Db }) {
	const todayRotaNumber = getRotaNumberForDate(new Date());
	const data = await db
		.select({
			telegramChatId: rotaTable.telegramChatId,
		})
		.from(rotaTable)
		.where(and(eq(rotaTable.rota, todayRotaNumber.toString() as '1' | '2' | '3' | 'OFFICE_HOURS'), eq(rotaTable.rota, 'OFFICE_HOURS')));

	return data.map((row) => row.telegramChatId);
}

export async function getRotaForChatId({ chatId, db }: { chatId: number; db: Db }) {
	const data = await db
		.select({
			rota: rotaTable.rota,
		})
		.from(rotaTable)
		.where(eq(rotaTable.telegramChatId, chatId))
		.limit(1);

	if (data.length === 0) {
		return null;
	}

	return data[0].rota;
}
