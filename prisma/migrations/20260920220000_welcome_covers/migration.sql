-- CreateEnum
CREATE TYPE "WelcomeCoverVariant" AS ENUM ('MOBILE', 'TABLET', 'DESKTOP');

-- CreateEnum
CREATE TYPE "WelcomeCoverStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "WelcomeCoverAsset" (
    "id" TEXT NOT NULL,
    "variant" "WelcomeCoverVariant" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "blurhash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WelcomeCoverAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WelcomeCover" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WelcomeCoverStatus" NOT NULL DEFAULT 'DRAFT',
    "mobileAssetId" TEXT,
    "tabletAssetId" TEXT,
    "desktopAssetId" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WelcomeCover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeCoverAsset_storageKey_key" ON "WelcomeCoverAsset"("storageKey");

-- CreateIndex
CREATE INDEX "WelcomeCover_status_startsAt_endsAt_idx" ON "WelcomeCover"("status", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "WelcomeCoverAsset" ADD CONSTRAINT "WelcomeCoverAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeCover" ADD CONSTRAINT "WelcomeCover_mobileAssetId_fkey" FOREIGN KEY ("mobileAssetId") REFERENCES "WelcomeCoverAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeCover" ADD CONSTRAINT "WelcomeCover_tabletAssetId_fkey" FOREIGN KEY ("tabletAssetId") REFERENCES "WelcomeCoverAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeCover" ADD CONSTRAINT "WelcomeCover_desktopAssetId_fkey" FOREIGN KEY ("desktopAssetId") REFERENCES "WelcomeCoverAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeCover" ADD CONSTRAINT "WelcomeCover_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
