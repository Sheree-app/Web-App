import { api } from "@/lib/api";

/** A beautician the customer has had at least one completed appointment with. */
export type WorkedWithProfessional = {
  professionalId: string;
  name: string;
  avatarUrl: string | null;
  location: string | null;
  visits: number;
  lastVisit: string;
  lastService: string;
};

type BeauticianRow = {
  professional_id: string;
  name: string;
  avatar_url: string | null;
  location: string | null;
  visits: number;
  last_visit: string;
  last_service: string;
};

/** `GET /v1/me/beauticians`: everyone the customer has worked with, most recent first. */
export async function fetchWorkedWithProfessionals(): Promise<WorkedWithProfessional[]> {
  const rows = await api.get<BeauticianRow[]>('/v1/me/beauticians');
  return rows.map((row) => ({
    professionalId: row.professional_id,
    name: row.name || 'Your professional',
    avatarUrl: row.avatar_url ?? null,
    location: row.location ?? null,
    visits: Number(row.visits),
    lastVisit: row.last_visit,
    lastService: row.last_service,
  }));
}
