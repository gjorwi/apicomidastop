import dns from 'node:dns';
import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'Falta MONGODB_URI. Copia api/.env.example a api/.env y configura MongoDB Atlas.',
    );
  }

  mongoose.set('strictQuery', true);

  const options = {
    dbName: process.env.MONGODB_DB || 'comidastop',
    serverSelectionTimeoutMS: 10000,
  };

  try {
    await mongoose.connect(uri, options);
  } catch (error) {
    const srvFailure =
      uri.startsWith('mongodb+srv://') &&
      /querySrv|ECONNREFUSED|ETIMEOUT|ENOTFOUND/i.test(error.message || '');

    if (!srvFailure) throw error;

    const servers = (process.env.MONGODB_DNS_SERVERS || '1.1.1.1,8.8.8.8')
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);

    console.warn(
      `No se pudo resolver el SRV de MongoDB. Reintentando con DNS: ${servers.join(', ')}`,
    );
    dns.setServers(servers);
    await mongoose.connect(uri, options);
  }

  console.log(`MongoDB conectado: ${mongoose.connection.name}`);
}
