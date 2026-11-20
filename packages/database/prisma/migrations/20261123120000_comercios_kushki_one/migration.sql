-- CreateTable
CREATE TABLE "comercios_kushki_one" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_code_cifrado" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comercios_kushki_one_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comercios_kushki_one_user_id_key" ON "comercios_kushki_one"("user_id");

-- AddForeignKey
ALTER TABLE "comercios_kushki_one" ADD CONSTRAINT "comercios_kushki_one_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
