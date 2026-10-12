-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('STARTING', 'WAITING_QR', 'LOGGED_IN', 'FILLING', 'SUBMITTING', 'RETRYING', 'DONE', 'FAILED', 'STOPPED');

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bodyNumber" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "tel" TEXT NOT NULL,
    "desiredNumber" TEXT NOT NULL,
    "carType" INTEGER NOT NULL,
    "pers" INTEGER NOT NULL,
    "applicantIdCard" TEXT,
    "applicantPrefix" TEXT,
    "applicantFname" TEXT,
    "applicantLname" TEXT,
    "cronExpression" TEXT NOT NULL,
    "runOnce" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'STARTING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "confirmId" TEXT,
    "submitStatus" INTEGER,
    "pageTitle" TEXT,
    "bodyText" TEXT,
    "dialogMessages" TEXT[],
    "screenshotPath" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Run_reservationId_startedAt_idx" ON "Run"("reservationId", "startedAt");

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
