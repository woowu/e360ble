#!/usr/bin/node --harmony
'use strict';

import fs from 'node:fs';
import dump from 'buffer-hexdump';
import yargs from 'yargs/yargs';
import noble from '@abandonware/noble';
import { prettyPrint } from '@base2/pretty-print-object';
import prettyjson from 'prettyjson';

async function startScan(service, allowDup)
{
    noble.on('stateChange', async (state) => {
        if (service) console.log(service);
        if (state === 'poweredOn') await noble.startScanningAsync(
            service ? service.split(',') : [], allowDup);
    });
}

async function connectDevice(address)
{
    return new Promise((resolve, reject) => {
        noble.on('discover', async peri => {
            if (peri.address != address.toLowerCase())
                return;
            await noble.stopScanningAsync();
            console.log('scan stopped');
            await peri.connectAsync();
            console.log('connected');
            setTimeout(() => {
                peri.disconnectAsync();
                console.log('disconnected');
                process.exit(0);
            }, 8000);
            resolve(peri);
        });
        startScan(null, false);
    });
}

function deviceInfo(peripheral)
{
    return new Promise((resolve, reject) => {
        peripheral.discoverAllServicesAndCharacteristics(
            (error, services, characteristics) => {
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
}

/*---------------------------------------------------------------------------*/

const argv = yargs(process.argv.slice(2))
    .version('0.0.1')
    .command('scan',
        'scan devices',
        yargs => {
            yargs
                .option('s', {
                    alias: 'service',
                    type: 'string',
                    describe: 'Service UUIDs, separated with comma',
                })
                .option('a', {
                    alias: 'address',
                    type: 'string',
                    describe: 'Full or partial of a bluetooth device address as a filter. '
                        + 'An example TI CC24* address: 84:72:93:f5:1e:63',
                })
        },
        async (argv) => {
            noble.on('discover', async peripheral => {
                const {_noble, ...peri} = peripheral;
                if (! argv.address
                    || peri.address.includes(argv.address.toLowerCase())) {
                    console.log('++', peri.address, peri.rssi);
                    console.log(prettyPrint(peri, { indent: '  ' }));
                }
            });
            startScan(argv.service, true);
        })
    .command('dump-att',
        'dump attributes',
        yargs => {
            yargs
                .option('a', {
                    alias: 'address',
                    type: 'string',
                    requiresArg: true,
                    describe: '64-bit bluetooth device address, e.g., 00:11:22:33:FF:EE',
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
            const peri = await connectDevice(argv.address);
            const { services, characteristics } = await deviceInfo(peri);
            const out = [];

            for (const e of services) {
                const { _noble, ...ss } = e;
                if (ss.characteristics)
                    ss.characteristics = ss.characteristics.map(e => {
                        const { _noble, ...cs } = e;
                        return cs;
                    });
                out.push(ss);
            }
            console.log(`${services.length} services`);
            console.log(`${characteristics.length} characteristics`);
            fs.writeFileSync(argv.output, prettyjson.render(out, { noColor: true }));

            //const c = findCharacteristic(characteristics, '2a00')
            //c.read((err, data) => {
            //    if (err)
            //        console.log(err);
            //    else
            //        console.log(data);
            //});
        })
    .argv;
