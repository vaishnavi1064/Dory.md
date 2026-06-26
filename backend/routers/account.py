"""Account self-service: data export and hard account deletion (GDPR).



Deletion is a literal right-to-erasure: ChromaDB vectors and every SQLite row

belonging to the user are removed. There is no soft-delete column and no grace

period — once it returns 204, the data is gone.

"""



import json

import logging

from datetime import date, datetime, timezone



from fastapi import APIRouter, Depends, HTTPException

from fastapi.responses import Response



from database.db import (

    delete_user_data,

    get_access_log,

    get_all_chunks,

    get_all_meetings_for_export,

    get_all_mood_logs_for_export,

    get_all_quiz_sessions_for_export,

    get_user_by_id,

)

from intelligence.retrieval import delete_user as chroma_delete_user

from routers.deps import get_current_user_id



logger = logging.getLogger("dory.account")



router = APIRouter()





def _row_to_dict(row, *, exclude: tuple[str, ...] = ()) -> dict:

    return {k: row[k] for k in row.keys() if k not in exclude}





@router.delete("/account", status_code=204)

def delete_account(user_id: str = Depends(get_current_user_id)):

    """Hard-delete the authenticated user's account and ALL associated data from

    both ChromaDB and SQLite."""

    # ChromaDB first: if this fails we abort before touching SQLite, so nothing is

    # half-deleted and the client can safely retry.

    try:

        chroma_delete_user(user_id)

    except Exception:

        logger.exception(

            "Account deletion: ChromaDB delete failed for user_id=%s; SQLite untouched",

            user_id,

        )

        raise HTTPException(

            status_code=500,

            detail="Failed to delete account data; nothing was removed. Please retry.",

        )



    # SQLite transaction. If this fails AFTER ChromaDB already succeeded, the

    # vectors are gone but the relational rows remain — log critically so it can be

    # reconciled by hand.

    try:

        deleted = delete_user_data(user_id)

    except Exception as err:

        logger.critical(

            f"Orphaned ChromaDB delete: user_id={user_id} vectors deleted but "

            f"SQLite transaction failed: {err}"

        )

        raise HTTPException(

            status_code=500,

            detail="Account partially deleted; please contact support.",

        )



    if not deleted:

        raise HTTPException(status_code=404, detail="Account not found.")

    return Response(status_code=204)





@router.get("/account/export")

def export_account(user_id: str = Depends(get_current_user_id)):

    """Return all of the user's data as a downloadable, pretty-printed JSON file.



    Included: user profile (no password_hash), chunks, access_log, quiz_sessions,

    chunk_state_log (mood logs), meetings.



    Excluded:

    - password_hash — credentials must never be exported, even hashed.

    - refresh_tokens — session state; exporting these would let anyone with the

      file forge active sessions if the tokens haven't expired.

    """

    user = get_user_by_id(user_id)

    if user is None:

        raise HTTPException(status_code=404, detail="Account not found.")



    payload = {

        "format_version": "1.0",

        "exported_at": datetime.now(timezone.utc).isoformat(),

        "user": _row_to_dict(user, exclude=("password_hash",)),

        "chunks": [_row_to_dict(r) for r in get_all_chunks(user_id)],

        "access_log": [_row_to_dict(r) for r in get_access_log(user_id)],

        "quiz_sessions": get_all_quiz_sessions_for_export(user_id),

        "chunk_state_log": get_all_mood_logs_for_export(user_id),

        "meetings": get_all_meetings_for_export(user_id),

    }

    body = json.dumps(payload, indent=2, default=str)

    filename = f"dory-export-{user_id}-{date.today().isoformat()}.json"

    return Response(

        content=body,

        media_type="application/json",

        headers={"Content-Disposition": f'attachment; filename="{filename}"'},

    )

