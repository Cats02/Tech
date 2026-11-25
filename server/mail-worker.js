import {createPool} from './db.js';
import {createMailer} from './mail.js';

async function work(){
    const pool=createPool();
    try {await createMailer(pool).processQueue();}
    finally {await pool.end();}
}
work().catch(()=>{console.error('Email worker failed. Check configuration and migrations.');process.exitCode=1;});
