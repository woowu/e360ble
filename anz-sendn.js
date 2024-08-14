#!/usr/bin/node --harmony
'use strict';
import dump from 'buffer-hexdump';
import yargs from 'yargs/yargs';
import readline from 'node:readline';
import fs from 'node:fs';

/**
 * We found there are communication issue by testing using the 'sendn' command
 * from 'e360ble'. The received data was not complete. Hence, this tool is
 * provied for checking the received data and find out what's the lost pattern.
 *
 * The input file to this tool is the output logs from the e360ble.
 */

const argv = yargs(process.argv.slice(2))
    .version('0.0.1')
    .option('f', {
        alias: 'file',
        type: 'string',
        demandOption: true,
    })
    .option('c', {
        alias: 'csv',
        type: 'string',
    })
    .argv;

const FIRST_PRINTABLE = 0x21;
const LAST_PRINTABLE = 0x7e;

const state = {
    offset: 0,
    expect: FIRST_PRINTABLE,
    lost: 0,
    received: 0,
};

function nextExpect(state)
{
    ++state.expect;
    if (state.expect > LAST_PRINTABLE)
        state.expect = FIRST_PRINTABLE;
}

function newLine(state, line)
{
    while (line.length) {
        const c = parseInt(line.slice(0, 2), 16);
        line = line.slice(2);

        var lost = 0;
        while (state.expect != c
            && lost <= LAST_PRINTABLE - FIRST_PRINTABLE + 1) {
            ++lost;
            nextExpect(state);
        }

        if (lost) {
            console.log(`lost ${lost} chars before offset ${state.offset}`);
            if (state.csv)
                state.csv.write(`${state.offset},${lost}\n`);
            state.lost += lost;
        }
        nextExpect(state);
        ++state.offset;
        ++state.received;
    }
}

const file = argv.file;
const rl = readline.createInterface({ input: fs.createReadStream(file) });
if (argv.csv) {
    state.csv = fs.createWriteStream(argv.csv);
    state.csv.write('Offset,Lost\n');
}

rl.on('line',  line => {
    line = line.trim();
    if (! line) return;

    /* xxd output file put hex data at offset interval [10, 49) for
     * each line.
     */
    const hex = line.slice(10, 49).split(' ').join('');
    newLine(state, hex);
});
rl.on('close', () => {
    console.log(`received ${state.received} octets, known lost ${state.lost} octets`);
    if (state.csv) state.csv.close();
});

