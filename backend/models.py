"""SQLAlchemy schema for users, jobs, clips and channel analytics."""
from sqlalchemy import (
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    user_agent: Mapped[str] = mapped_column(String(300), default="")


class Setting(Base):
    __tablename__ = "settings"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    secret: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    kind: Mapped[str] = mapped_column(String(20), default="batch")  # batch | series
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("batches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="analyze")  # analyze | manual | render
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(40), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_count: Mapped[int] = mapped_column(Integer, default=2)
    candidates: Mapped[str] = mapped_column(Text, default="[]")
    selected: Mapped[str] = mapped_column(Text, default="[]")
    uploads: Mapped[str] = mapped_column(Text, default="[]")
    options: Mapped[str] = mapped_column(Text, default="{}")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    queued_at: Mapped[float] = mapped_column(Float, nullable=False)
    started_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    finished_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)


class JobLog(Base):
    __tablename__ = "job_logs"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    ts: Mapped[float] = mapped_column(Float, nullable=False)
    level: Mapped[str] = mapped_column(String(16), default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)


class Clip(Base):
    __tablename__ = "clips"
    __table_args__ = (UniqueConstraint("user_id", "path", name="uq_clip_user_path"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text, default="Short")
    description: Mapped[str] = mapped_column(Text, default="")
    path: Mapped[str] = mapped_column(Text, nullable=False)
    thumb: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    uploaded: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    privacy: Mapped[str | None] = mapped_column(String(20), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    youtube_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    scheduled_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    upload_state: Mapped[str] = mapped_column(String(20), default="idle", index=True)
    upload_progress: Mapped[float] = mapped_column(Float, default=0.0)
    upload_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    qa_status: Mapped[str] = mapped_column(String(20), default="pending")
    qa_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class VideoStat(Base):
    __tablename__ = "video_stats"
    __table_args__ = (UniqueConstraint("user_id", "video_id", name="uq_user_video"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[str] = mapped_column(String(40), default="")
    views: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), default=0)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments: Mapped[int] = mapped_column(Integer, default=0)
    watch_time_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    avg_view_duration: Mapped[float] = mapped_column(Float, default=0.0)
    avg_view_percentage: Mapped[float] = mapped_column(Float, default=0.0)
    subs_gained: Mapped[int] = mapped_column(Integer, default=0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    ctr: Mapped[float] = mapped_column(Float, default=0.0)
    fetched_at: Mapped[float] = mapped_column(Float, nullable=False)


class ChannelSnapshot(Base):
    __tablename__ = "channel_snapshots"
    __table_args__ = (UniqueConstraint("user_id", "ts", name="uq_user_snapshot_ts"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ts: Mapped[float] = mapped_column(Float, nullable=False)
    subs: Mapped[int] = mapped_column(Integer, default=0)
    total_views: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), default=0)
    video_count: Mapped[int] = mapped_column(Integer, default=0)


class OAuthState(Base):
    __tablename__ = "oauth_states"
    state: Mapped[str] = mapped_column(String(96), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)


class UserToken(Base):
    __tablename__ = "user_tokens"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(30), primary_key=True)
    token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)


class VideoCache(Base):
    """Public, user-independent analysis cache keyed by YouTube video id.

    Transcripts, the most-replayed series and audio energy are expensive to
    rebuild but identical for every user, so they live outside the user scope.
    Only public video metadata is stored here — never cookies or credentials.
    """

    __tablename__ = "video_cache"
    video_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    title: Mapped[str] = mapped_column(Text, default="")
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    heatmap: Mapped[str] = mapped_column(Text, default="[]")
    energy: Mapped[str] = mapped_column(Text, default="[]")
    transcript: Mapped[str] = mapped_column(Text, default="[]")
    updated_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)


Index("ix_jobs_user_status", Job.user_id, Job.status)
Index("ix_clips_user_uploaded", Clip.user_id, Clip.uploaded)
Index("ix_video_stats_user_fetched", VideoStat.user_id, VideoStat.fetched_at)
