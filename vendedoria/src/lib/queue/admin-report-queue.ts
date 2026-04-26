import { Queue, Worker, Job } from "bullmq";
import type { RedisOptions } from "ioredis";
import { sendDailyReport } from "@/lib/admin/admin-report.service";

const QUEUE_NAME = "admin-report";

// ─── Connection ───────────────────────────────────────────────────────────────

function getBullMQConnection(): RedisOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  };
}

// ─── Queue singleton ──────────────────────────────────────────────────────────

interface AdminReportJobData {
  label: "13h" | "18h";
}

let _queue: Queue<AdminReportJobData> | null = null;

function getAdminReportQueue(): Queue<AdminReportJobData> {
  if (!_queue) {
    _queue = new Queue<AdminReportJobData>(QUEUE_NAME, {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: "exponential", delay: 60_000 },
      },
    });
    _queue.on("error", (err) =>
      console.error("[AdminReportQueue] Redis error:", err.message),
    );
  }
  return _queue;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let _worker: Worker<AdminReportJobData> | null = null;

function startAdminReportWorker(): Worker<AdminReportJobData> {
  if (_worker) return _worker;

  _worker = new Worker<AdminReportJobData>(
    QUEUE_NAME,
    async (job: Job<AdminReportJobData>) => {
      console.log(`[AdminReportWorker] Sending ${job.data.label} report`);
      await sendDailyReport(job.data.label);
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );

  _worker.on("completed", (job) =>
    console.log(`[AdminReportWorker] Job ${job.id} completed`),
  );
  _worker.on("failed", (job, err) =>
    console.error(`[AdminReportWorker] Job ${job?.id} failed:`, err.message),
  );
  _worker.on("error", (err) =>
    console.error("[AdminReportWorker] Redis error:", err.message),
  );

  console.log("[AdminReportWorker] Started — listening for report jobs");
  return _worker;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// Registers two repeatable cron jobs: 13h and 18h Brasília time.
// BullMQ v5 supports `tz` in repeat options, so we can use local time directly.

export async function scheduleAdminReports(): Promise<void> {
  const queue = getAdminReportQueue();
  startAdminReportWorker();

  await Promise.all([
    queue.add(
      "daily-13h",
      { label: "13h" },
      {
        jobId: "admin-report-13h",
        repeat: { pattern: "0 13 * * *", tz: "America/Sao_Paulo" },
      },
    ),
    queue.add(
      "daily-18h",
      { label: "18h" },
      {
        jobId: "admin-report-18h",
        repeat: { pattern: "0 18 * * *", tz: "America/Sao_Paulo" },
      },
    ),
  ]);

  console.log("[AdminReport] Scheduled daily reports at 13h and 18h (Brasília)");
}
