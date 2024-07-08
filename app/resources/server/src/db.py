import hashlib
import os
import sqlalchemy
from sqlalchemy import Table, Column, String, Text, MetaData
from databases import Database

DATABASE_URL = "sqlite:///./resources/server/summaries.db"
database = Database(DATABASE_URL)
metadata = MetaData()

summaries_table = Table(
    "summaries",
    metadata,
    Column("file_hash", String, primary_key=True),
    Column("file_type", String),
    Column("summary", Text),
)

async def hash_file_contents(file_path: str) -> str:
    if not os.path.isfile(file_path):
        return ""

    hash_func = hashlib.sha256()
    try:
        with open(file_path, 'rb') as f:
            while chunk := f.read(1024):
                hash_func.update(chunk)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=f"Permission denied: {file_path}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

    return hash_func.hexdigest()

async def get_summary_from_db(file_path: str) -> str:
    file_hash = await hash_file_contents(file_path)

    if len(file_hash) > 0:
        query = summaries_table.select().where(summaries_table.c.file_hash == file_hash)
        result = await database.fetch_one(query)
        if result:
            return result['summary']

    return ""

async def store_summary_in_db(file_hash: str, file_type: str, summary: str):
    query = sqlalchemy.dialects.sqlite.insert(summaries_table).values(
        file_hash=file_hash,
        file_type=file_type,
        summary=summary
    ).on_conflict_do_update(
        index_elements=['file_hash'],
        set_=dict(summary=summary, file_type=file_type)
    )
    await database.execute(query)

engine = sqlalchemy.create_engine(DATABASE_URL)
metadata.create_all(engine)