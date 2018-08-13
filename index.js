const argv = require('yargs').argv;
const fs = require('fs-promise');
const _ = require('lodash');
const createThrottle = require('async-throttle');

const songPrettify = require('./songPrettify');

function main() {
    const inputDir = argv.i;
    const outputDir = argv.o;

    if (!inputDir || !outputDir) {
        console.log('Usage:');
        console.log('\tsongPrettify -i input_directory -o output_directory');

        return;
    }

    processFile(inputDir, `${__dirname}`)
        .then(dataToProcess => {
            const throttle = createThrottle(1);

            const dataTotalCount = dataToProcess.length;
            let processedCount = 0;

            console.log(`Number of songs: ${dataTotalCount}`);

            const promises = dataToProcess.map(d => throttle(() =>
                songPrettify({
                    filename: d.filename,
                    pathfile: d.path,
                    parentDir: d.parentDir,
                    outputDir: `${__dirname}/${outputDir}`
                })
                    .then(d => {
                        processedCount++;

                        console.log(`${processedCount}/${dataTotalCount} - ${(processedCount / dataTotalCount * 100).toFixed()}%\t(${d.metadata ? d.metadata.title : d.filename }) (${d.type})`);

                        return Promise.resolve(d);
                    })
                )
            );

            return Promise.all(promises);
        })
        .then(result => {
            console.log(`Done`);
        })
        .catch(err => {
            console.log('An error has occured.');
            console.log(err);
        });
}

function processFile(filename, parentDir) {
    return fs.stat(`${parentDir}/${filename}`)
        .then(stats => {
            if (stats.isFile()) {
                return Promise.resolve({
                    filename,
                    parentDir,
                    path: `${parentDir}/${filename}`
                });
            }
            else if (stats.isDirectory()) {
                const folderPath = `${parentDir}/${filename}`
                return fs.readdir(folderPath)
                    .then(files => {
                        const formatted = files.map(f => processFile(f, `${folderPath}`));

                        return Promise.all(formatted);
                    })
                    .then(files => {
                        return Promise.resolve(_.flattenDeep(files))
                    });
            }
            else {
                return Promise.resolve(null);
            }
        });
}

main();
