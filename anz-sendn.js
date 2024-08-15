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

const MESSAGE_HEAD = 0x21;
const MESSAGE_TAIL = 0x7e;

const argv = yargs(process.argv.slice(2))
    .version('0.0.1')
    .option('s', {
        alias: 'size',
        type: 'number',
        description: 'size of each packet',
        demandOption: true,
    })
    .option('n', {
        alias: 'count',
        type: 'number',
        description: 'number of packets',
        demandOption: true,
    })
    .option('f', {
        alias: 'file',
        type: 'string',
        description: 'e360ble log file containing received data',
        demandOption: true,
    })
    .option('c', {
        alias: 'csv',
        type: 'string',
        description: 'a csv file for saving analysis results',
    })
    .option('b', {
        alias: 'bin',
        type: 'string',
        description: 'for saving received data in a binary file',
    })
    .argv;

/*---------------------------------------------------------------------------*/

var state = {
    packetTail: null,
    receiverOffset: 0,
    pending: [],
    lost: 0,
    bad: 0,
};

function config(state, options)
{
    const s = Object.assign({}, state, options);
    if (s.csv)
        s.csv.write('Offset,Lost\n');
    const r = s.packetSize % (MESSAGE_TAIL - MESSAGE_HEAD + 1);
    s.packetTail = r ? r - 1 + MESSAGE_HEAD : MESSAGE_TAIL;
    s.senderSize = s.packetSize * s.packetCount;
    return s;
}

function checkMessage(state, last = false)
{
    if (! state.pending.length) return;

    const start = state.pending[0];
    const end = state.pending.slice(-1)[0];
    const offset = state.receiverOffset - state.pending.length;

    for (var i = 0; i < state.pending.length; ++i) {
        if (state.pending[i] != state.pending[0] + i) {
            console.log(`bad char at ${addrStr(offset + i)}`);
            ++state.bad;
        }
    }

    if (state.pending.length == MESSAGE_TAIL - MESSAGE_HEAD + 1)
        return;

    if (start != MESSAGE_HEAD) {
        console.log(`lost ${start - MESSAGE_HEAD} octets before ${addrStr(offset)}`)
        state.lost += start - MESSAGE_HEAD;
        if (state.csv)
            state.csv.write(`${offset},${start - MESSAGE_HEAD}\n`);
    }
    if (! last && end != MESSAGE_TAIL && end != state.packetTail) {
        /* the number of lost is this case could be over estimated because the real tail char may
         * not be the message tail char but the packet tail char.
         */
        console.log(`lost ${MESSAGE_TAIL - end} octets before ${addrStr(state.receiverOffset)}`)
        state.lost += MESSAGE_TAIL - end;
        if (state.csv)
            state.csv.write(`${state.receiverOffset},${start - MESSAGE_HEAD}\n`);
    }
}

function putChar(state, c)
{
    if (state.bin) state.bin.write(Buffer.from([c]));

    if (c == MESSAGE_HEAD) {
        checkMessage(state);
        state.pending = [c];
    } else
        state.pending = [...state.pending, c];

    ++state.receiverOffset;
}

function newLine(state, line)
{
    while (line.length) {
        putChar(state, parseInt(line.slice(0, 2), 16));
        line = line.slice(2);
    }
}

/*---------------------------------------------------------------------------*/

function addrStr(addr)
{
    return '0x' + addr.toString(16).padStart(8, '0')
}

/*---------------------------------------------------------------------------*/

state = config(state, {
    packetSize: argv.size,
    packetCount: argv.count,
    bin: argv.bin ? fs.createWriteStream(argv.bin) : null,
    csv: argv.csv ? fs.createWriteStream(argv.csv) : null,
});

const rl = readline.createInterface({ input: fs.createReadStream(argv.file) });
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
    checkMessage(state, true);
    console.log(`received ${state.receiverOffset} octets,`
        + ` ${state.lost} + ${state.senderSize - state.receiverOffset}`
        + ` octets lost, ${state.bad} bad`);
    if (state.csv) state.csv.close();
    if (state.bin) state.bin.close();
});

