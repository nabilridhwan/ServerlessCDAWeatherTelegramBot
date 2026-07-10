import { rule } from './bot/rule';
import getRotaNumberForDate from './getRotaNumberForDate';

export function getNextUpdateDateForRota(rota: '1' | '2' | '3' | 'OFFICE_HOURS', fromDate: Date = new Date()): Date | null {
	let cursor = fromDate;

	for (let attempt = 0; attempt < 200; attempt++) {
		const nextInvocation = rule.nextInvocationDate(cursor);

		if (!nextInvocation) {
			return null;
		}

		const nextDate = nextInvocation;

		if (rota === 'OFFICE_HOURS' || getRotaNumberForDate(nextDate) === Number(rota)) {
			return nextDate;
		}

		cursor = new Date(nextDate.getTime() + 60_000);
	}

	return null;
}
