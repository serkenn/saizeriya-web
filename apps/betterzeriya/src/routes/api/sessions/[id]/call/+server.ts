import { json, type RequestHandler } from '@sveltejs/kit'
import { callOfficialStaff, parseOfficialSessionSnapshot } from '$lib/server/official-client'

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json().catch(() => ({}))
    return json(
      await callOfficialStaff(
        params.id ?? '',
        Boolean(body.after),
        parseOfficialSessionSnapshot(body.officialSession),
      ),
    )
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to call staff' },
      { status: 502 },
    )
  }
}
