import { z } from 'zod';
export function schemas() {
    const date = () =>
        z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional();
    return {
        get_date_info: { date: date() },
        get_almanac: { date: date() },
        get_shichen: { date: date() },
        get_festivals: { start_date: date(), end_date: date() },
        search_next_festival: { festival_name: z.string().trim().min(1).max(60) }
    };
}
