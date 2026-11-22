import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { Category, User } from './models/index.js';
import { baseCategories } from './data/categories.js';

async function bootstrap() {
  await connectDB();

  await Promise.all([Category.syncIndexes(), User.syncIndexes()]);

  let createdCategories = 0;
  let updatedCategories = 0;

  for (const [index, category] of baseCategories.entries()) {
    const result = await Category.updateOne(
      { key: category.key },
      {
        $set: {
          name: category.name,
          image: category.image,
          average: category.average,
          order: index,
          isActive: true,
        },
        $setOnInsert: { key: category.key },
      },
      { upsert: true },
    );

    if (result.upsertedCount) createdCategories += 1;
    else updatedCategories += 1;
  }

  const adminName = process.env.ADMIN_NAME || 'Administrador';
  const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'Faltan ADMIN_EMAIL o ADMIN_PASSWORD en api/.env para crear el administrador.',
    );
  }

  const existingAdmin = await User.findOne({ email: adminEmail });

  if (existingAdmin && existingAdmin.role !== 'admin') {
    throw new Error(
      'El correo configurado como administrador ya pertenece a otra cuenta.',
    );
  }

  if (existingAdmin) {
    existingAdmin.name = adminName;
    existingAdmin.role = 'admin';
    existingAdmin.status = 'active';
    await existingAdmin.save();
    console.log(`Administrador existente actualizado: ${adminEmail}`);
  } else {
    await User.create({
      name: adminName,
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      status: 'active',
    });
    console.log(`Administrador creado: ${adminEmail}`);
  }

  console.log('Bootstrap completado sin datos de ejemplo:');
  console.log(`- ${createdCategories} categorías creadas`);
  console.log(`- ${updatedCategories} categorías actualizadas`);
  console.log('- No se crearon negocios, productos, solicitudes ni calificaciones.');
  console.log('- La contraseña del administrador existente no se modificó.');

  await mongoose.disconnect();
}

bootstrap().catch(async (error) => {
  console.error('Error al ejecutar el bootstrap:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
