#!/usr/bin/node --harmony
'use strict';

import fs from 'node:fs';
import dump from 'buffer-hexdump';
import yargs from 'yargs/yargs';
import nobleLegacy from '@abandonware/noble';
import Noble from '@abandonware/noble/with-custom-binding.js';
import prettyjson from 'prettyjson';
import ouiData from './oui-data.js';

const uuids = {
    terminalWrite:  'f000c0c104514000b000000000000000',
    terminalNotify: 'f000c0c204514000b000000000000000',
};

function useNoble(ble5)
{
    return ble5 ? Noble({extended: true}) : nobleLegacy;
}

function delay(ms)
{
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

function printPeripheral(peri)
{
    const {_noble, ...p} = peri;

    var localName = '';
    if (p.advertisement && p.advertisement.localName)
        localName = p.advertisement.localName;
    
    console.log('++', peri.address, localName, peri.rssi);
    const oui = p.address.split(':').slice(0, 3).join('').toUpperCase();
    if (ouiData[oui]) console.log(ouiData[oui]);

    if (p.advertisement && Buffer.isBuffer(p.advertisement.manufacturerData))
        p.advertisement.manufacturerData = p.advertisement.manufacturerData.toString('hex');
    console.log(prettyjson.render(p, { noColor: true }));
    console.log('');
}

async function startScan(noble, service, allowDup)
{
    noble.on('stateChange', async (state) => {
        if (state === 'poweredOn') await noble.startScanningAsync(
            service ? service.split(',') : [], allowDup);
    });
}

async function connectDevice(noble, address, autoDisconnect = true)
{
    return new Promise((resolve, reject) => {
        var visibleCount = 0;

        noble.on('discover', async peri => {
            if (peri.address != address.toLowerCase())
                return;
            if (++visibleCount != 3)
                return;

            await noble.stopScanningAsync();
            console.log('scan stopped');

            printPeripheral(peri);

            await peri.connectAsync();
            console.log('connected');

            if (autoDisconnect)
                setTimeout(async () => {
                    await peri.disconnectAsync();
                    console.log('disconnected');
                    process.exit(0);
                }, 8000);

            await delay(100);
            resolve(peri);
        });
        console.log('start scan');
        startScan(noble, null, true);
    });
}

async function disconnectAndExit(peri)
{
    await peri.disconnectAsync();
    console.log('disconnected');
    process.exit(0);
};

function fetchDeviceAttInfo(peripheral)
{
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            reject(new Error('fetching device att timeout'));
        }, 5000);

        peripheral.discoverAllServicesAndCharacteristics(
            (error, services, characteristics) => {
                if (error) {
                    reject(new Error('get service error'));
                    return;
                }
                resolve({ services, characteristics });
            });
    });
}

function findCharacteristic(characteristics, uuid)
{
    for (var i = 0; i < characteristics.length; ++i) {
        if (characteristics[i].uuid == uuid && characteristics)
            return characteristics[i];
    }
    return null;
}

/*---------------------------------------------------------------------------*/

const argv = yargs(process.argv.slice(2))
    .version('0.0.1')
    .option('e', {
        alias: 'ble5',
        type: 'boolean',
    })
    .command('scan',
        'scan devices',
        yargs => {
            yargs
                .option('a', {
                    alias: 'address',
                    type: 'string',
                    describe: 'Full or partial of a bluetooth device address as a filter. '
                        + 'An example TI CC24* address: 84:72:93:f5:1e:63',
                })
                .option('rssi-gt', {
                    type: 'number',
                    describe: 'RSSI number greater than the given value',
                    requiresArg: true,
                })
                .option('rssi-lt', {
                    type: 'number',
                    describe: 'RSSI number less than the given value',
                    requiresArg: true,
                })
                .option('s', {
                    alias: 'service',
                    type: 'string',
                    describe: 'Service UUIDs, separated with comma',
                })
        },
        async (argv) => {
            const noble = useNoble(argv.ble5);
            noble.on('discover', async peripheral => {
                const {_noble, ...peri} = peripheral;
                if (argv.address
                    && ! peri.address.includes(argv.address.toLowerCase()))
                    return;
                if (argv.rssiLt && parseInt(peri.rssi) >= argv.rssiLt)
                    return;
                if (argv.rssiGt && parseInt(peri.rssi) <= argv.rssiGt)
                    return;
                printPeripheral(peri);
            });
            startScan(noble, argv.service, true);
        })
    .command('dump-att',
        'dump attributes',
        yargs => {
            yargs
                .option('a', {
                    alias: 'address',
                    type: 'string',
                    requiresArg: true,
                    describe: '64-bit bluetooth device address, '
                        + 'e.g., 00:11:22:33:FF:EE',
                    demandOption: true,
                })
            yargs
                .option('o', {
                    alias: 'output',
                    type: 'string',
                    requiresArg: true,
                    describe: 'filename to save the output',
                    demandOption: true,
                })
        },
        async (argv) => {
            const noble = useNoble(argv.ble5);
            const peri = await connectDevice(noble, argv.address);

            try {
                const { services, characteristics } = await fetchDeviceAttInfo(peri);
                console.log(`${services.length} services`);
                console.log(`${characteristics.length} characteristics`);

                const ssOut = [];
                const csOut = [];

                for (const e of services) {
                    const { _noble, ...ss } = e;
                    if (ss.characteristics)
                        ss.characteristics = ss.characteristics.map(e => {
                            const { _noble, ...cs } = e;
                            return cs;
                        });
                    ssOut.push(ss);
                }
                for (const c of characteristics) {
                    const { _noble, ...cs } = c;
                    csOut.push(cs);
                }
                fs.writeFile(argv.output, prettyjson.render({
                        services: ssOut,
                        characterstics: csOut,
                    }, { noColor: true })
                    , err => {});
            } catch (e) {
                await disconnectAndExit(peri);
            }
        })
    .command('sendn',
        'do send-n test using the Terminal service and the meter echo server',
        yargs => {
            yargs
                .option('a', {
                    alias: 'address',
                    type: 'string',
                    requiresArg: true,
                    describe: '64-bit bluetooth device address, '
                        + 'e.g., 00:11:22:33:FF:EE',
                    demandOption: true,
                })
                .option('n', {
                    alias: 'count',
                    type: 'number',
                    requiresArg: true,
                    describe: 'ask the device to send <n> packages',
                    default: 3,
                })
                .option('s', {
                    alias: 'size',
                    type: 'number',
                    requiresArg: true,
                    describe: 'size of each packet',
                    default: 244,
                })
                .option('d', {
                    alias: 'delay',
                    type: 'number',
                    requiresArg: true,
                    describe: 'inter-packet delay (ms)',
                    default: 10,
                })
                .option('l', {
                    alias: 'log',
                    type: 'string',
                    requiresArg: true,
                    describe: 'save the traffics to a file',
                    default: 244,
                })
        },
        async (argv) => {
            const noble = useNoble(argv.ble5);
            const peri = await connectDevice(noble, argv.address, false);
            var cWrite;
            var cNotify;

            try {
                const { services, characteristics }
                    = await fetchDeviceAttInfo(peri);
                cWrite = findCharacteristic(characteristics
                    , uuids.terminalWrite);
                cNotify = findCharacteristic(characteristics
                    , uuids.terminalNotify);
                if (! cWrite || ! cNotify) {
                    console.log('characteristics not found');
                    await disconnectAndExit(peri);
                    return;
                }
            } catch (e) {
                console.log(e);
                await disconnectAndExit(peri);
            }

            console.log('subscribe');
            cNotify.subscribe(err => {
                var timer;
                var readCount = 0;
                var startTime; 
                var lastTime;
                var recvLen = 0;
                var logSink;

                const startTimer = () => {
                    timer = setTimeout(async () => {
                        logSink.end();
                        const rate = (recvLen * 8) * 1e3/(lastTime - startTime)
                        console.log(`receved ${recvLen} bytes in `
                            + `${(lastTime - startTime)/1e3} seconds, `
                            + `data rate is ${rate.toFixed(3)} bps`);
                        await disconnectAndExit(peri);
                    }, 5000);
                };

                if (err) {
                    console.log('subscribe error:', err);
                    return;
                }

                if (argv.log) logSink = fs.createWriteStream(argv.log);

                cNotify.on('read', (data, notify) => {
                    if (timer) clearTimeout(timer);

                    if (++readCount == 1) startTime = new Date();
                    lastTime = new Date();

                    console.log(`${readCount} got data. len ${data.length}`);
                    if (argv.log) {
                        logSink.write(`-- ${readCount}\n`);
                        logSink.write(dump(data) + '\n');
                    }
                    recvLen += data.length;
                    startTimer();
                });
                startTimer();
                console.log('listen to notify');

                cWrite.write(Buffer.from(`SENDn ${argv.count} ${argv.size} ${argv.delay}`), false, err => {
                    if (err) console.log('write error:', err);
                });
            });
        })
    .argv;
