'use strict';
require('dotenv').config();
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');

const MONGO_URI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://localhost:27017/iceberg_tickets';

// Admin Maestros a excluir (ya existen en el sistema)
const IT_MASTERS = [
  'aprendiz.sistemas@iceberg.com.co',
  'soporte2@iceberg.com.co',
  'soporteti@iceberg.com.co',
  'gustavo.velandia@iceberg.com.co'
];

async function run() {
  try {
    console.log('🚀 Iniciando Ingesta IT 2026 (Modo Limpieza Profunda)...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Conectado a MongoDB.');

    const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
      id: { type: String, unique: true },
      name: String,
      email: { type: String, unique: true },
      password: { type: String, default: null },
      role: { type: String, default: 'user' },
      area: { type: String, default: 'General' },
      active: { type: Boolean, default: true }
    }));

    const excelPath = path.join(__dirname, '..', 'data', 'CorreosIceberg 2026.xlsx');
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`📊 Registros totales en el archivo: ${data.length}`);

    let registered = 0;
    let errors = 0;

    for (let row of data) {
      try {
        // Limpiamos los datos de cualquier salto de línea o basura
        let email = (row['Email'] || row['email'] || '').toString().replace(/\r?\n/g, '').toLowerCase().trim();
        let nombre = (row['Observacion'] || row['Observación'] || row['Nombre'] || email.split('@')[0]).toString().replace(/\r?\n/g, '').trim();
        let area = (row['Empresa'] || row['Area'] || 'General').toString().replace(/\r?\n/g, '').trim();
        let estado = (row['Estado'] || 'ACTIVO').toString().toUpperCase().trim();

        if (!email || !email.includes('@')) continue;

        // Si el Email es compuesto (como en el error de la foto), lo dividimos y procesamos el primero
        if (email.includes('\r') || email.includes('\n')) {
           email = email.split(/[\r\n]+/)[0].trim();
        }

        // SOLUCIÓN AL ERROR E11000: Usamos el email como ID único para evitar colisiones entre dominios
        const finalId = email; 

        if (IT_MASTERS.includes(email)) {
          console.log(`⏩ Admin protegido: ${email}`);
          continue;
        }

        await User.findOneAndUpdate(
          { email: email },
          { 
            id: finalId, // Usamos el email completo como ID único
            name: nombre, 
            email: email, 
            area: area, 
            active: estado === 'ACTIVO',
            role: 'user'
          },
          { upsert: true, returnDocument: 'after' }
        );
        registered++;
      } catch (e) {
        console.error(`⚠️ Error en fila:`, e.message);
        errors++;
      }
    }

    console.log(`\n✨ RESUMEN FINAL:`);
    console.log(`✅ Registrados con éxito: ${registered}`);
    console.log(`❌ Errores omitidos: ${errors}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ ERROR CRÍTICO:', err.message);
    process.exit(1);
  }
}

run();
