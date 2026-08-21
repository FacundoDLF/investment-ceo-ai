import fs from 'fs';
import { exec } from 'child_process';
import path from 'path';

const logFile = path.join(__dirname, 'monitor_daemon.log');

const daemon = exec('npx tsx --env-file=.env src/processes/daemon/ceo.loop.ts crypto', (error, stdout, stderr) => {});

let count = 0;
let buffer = '';
let checkInterval = setInterval(() => {
    // Escuchar directamente los streams es mejor
}, 5000);

daemon.stdout?.on('data', (data) => {
    process.stdout.write(data);
    const text = data.toString();
    const matches = text.match(/ciclo cerrado/g);
    if (matches) {
        count += matches.length;
        console.log(`\n\n--- COMPLETADAS: ${count}/10 ITERACIONES ---\n\n`);
        if (count >= 10) {
            console.log('✅ EXITO: 10 iteraciones completadas de manera resiliente.');
            daemon.kill();
            process.exit(0);
        }
    }
});

daemon.stderr?.on('data', (data) => {
    process.stderr.write(data);
    const text = data.toString();
    if (text.includes('Fallo irreversible') || text.includes('UnhandledPromiseRejectionWarning')) {
        console.error('❌ ERROR FATAL EN EL DAEMON');
        daemon.kill();
        process.exit(1);
    }
});
