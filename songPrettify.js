const fs = require('fs');
const fsp = require('fs-promise');
const request = require('request-promise-native');
const requestn = require('request');
const cheerio = require('cheerio');
const mm = require('musicmetadata');
const id3 = require('node-id3');
const path = require('path');
const mkdirp = require('mkdirp');

const API_KEY = '3088dc0a1dc1cd307430196883f8d508';

function main({ filename, pathfile, parentDir, outputDir }) {
    const extension = path.extname(filename);

    // try to read metadata first
    return readMetadata(pathfile)
        .then(metadata => {
            if (metadata.title && metadata.artist && metadata.album && metadata.image.length > 0) {
                const outputFolderForFile = `${outputDir}/${metadata.artist}/${metadata.album}`;
                const outputFilePath = `${outputFolderForFile}/${metadata.title}${extension}`;

                return createFolderIfNotExists(outputFolderForFile)
                    .then(() => {
                        return copyFile(pathfile, outputFilePath);
                    })
                    .then(() => {
                        return Promise.reject('METADATA_EXISTS');
                    });
            }
            else {
                return getInfo(filename)
                    .then(info => {
                        const outputFolderForFile = `${outputDir}/${info.artist}/${info.albumName || 'Unknown'}`;
                        const outputFilePath = `${outputFolderForFile}/${info.title}${extension}`;

                        return createFolderIfNotExists(outputFolderForFile)
                            .then(() => {
                                return copyFile(pathfile, outputFilePath);
                            })
                            .then(() => {
                                return writeMetadata(outputFilePath, info);
                            })
                            .catch((err) => {
                                return Promise.reject(err);
                            });
                    })
                    .then((metadata) => {
                        return Promise.resolve({
                            type: 'SUCCESS',
                            pathfile,
                            metadata
                        });
                    })
                    .catch(err => {
                        return Promise.reject(err);
                    });
            }
        })
        .catch(err => {
            console.log(err);
            if (err === 'METADATA_EXISTS') {
                return Promise.resolve({
                    type: 'COPIED',
                    pathfile,
                    filename
                });
            }
            else {
                const unsortedPath = `${outputDir}/Unsorted`;
                            
                return createFolderIfNotExists(unsortedPath)
                    .then(() => {
                        return copyFile(pathfile, `${unsortedPath}/${filename}`)
                    })
                    .then(() => {
                        return Promise.resolve({
                            type: err === 'UNSORTED' || err === 'GOOGLE_CAPTCHA' ? err : 'ERROR',
                            pathfile,
                            filename,
                            err
                        })
                    })
                    .catch(err => {
                        return Promise.resolve({
                            type: err === 'UNSORTED' || err === 'GOOGLE_CAPTCHA' ? err : 'ERROR',
                            pathfile,
                            filename,
                            err
                        })
                    });
            }
        });
}

function createFolderIfNotExists(pathdir) {
    return new Promise((resolve, reject) => {
        mkdirp(pathdir, (err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(pathdir);
            }
        })
    });
}

function copyFile(input, output) {
    return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(input);
        const writeStream = fs.createWriteStream(output);

        readStream.pipe(writeStream);

        readStream.on('error', rejectCleanup);
        writeStream.on('error', rejectCleanup);
        
        function rejectCleanup(err) {
            readStream.destroy();
            writeStream.end();
            reject(err);
        }

        writeStream.on('finish', () => {
            readStream.destroy();
            writeStream.end();
            resolve();
        });
    });
}

function readMetadata(filename) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filename);

        mm(stream, (err, metadata) => {
            if (err) {
                reject(err);
            }
            else {
                resolve({
                    title: metadata.title,
                    artist: metadata.artist[0],
                    album: metadata.album,
                    image: metadata.picture
                });
            }
            stream.close();
        });
    });
}

function writeMetadata(filename, metadata) {
    return new Promise((resolve, reject) => {
        // save album image file to tmp
        const albumImageFilepath = `${__dirname}/tmp/${metadata.albumImageId}`;

        requestn(metadata.albumImageUrl)
            .pipe(fs.createWriteStream(albumImageFilepath))
            .on('finish', () => { 
                const metadataStrippedImage = {
                    artist: metadata.artist,
                    title: metadata.title,
                    album: metadata.albumName || '',
                    image: albumImageFilepath
                };

                const success = id3.write(metadataStrippedImage, filename);

                if (success) {
                    fs.unlink(albumImageFilepath, () => {
                        resolve(metadataStrippedImage);
                    });
                }
                else {
                    reject('Writing failed');
                }
            });
    });
}

function getInfo(filename) {
    return getTitleAndArtist(filename)
        .then(({ title, artist }) => {
            return getAlbumInfo(title, artist)
                .then(albumInfo => {
                    return Promise.resolve(Object.assign({}, { title, artist }, albumInfo));
                })
                .catch(err => {
                    return Promise.reject(err);
                });
        })
        .catch(err => {
            return Promise.reject(err);
        });
}

function getTitleAndArtist(filename) {
    const extension = path.extname(filename);
    const strippedFilename = path.basename(filename, extension);

    if (!strippedFilename) {
        return Promise.reject('Malformed input');
    }

    return request(
        `https://www.google.com/search?q=${strippedFilename} azlyrics`
    )
        .then(body => {
            const $ = cheerio.load(body);

            const firstResult = $('.g')
                .first()
                .find('h3.r')
                .children()
                .first()
                .text();

            if (/^.+Lyrics -.+ - AZLyrics$/.test(firstResult)) {
                const splittedResult = firstResult.split('Lyrics - ');
                const artist = splittedResult[0].trim();
                const title = splittedResult[1].split(' - AZLyrics')[0].trim();

                return Promise.resolve({
                    title,
                    artist
                });
            } else {
                return Promise.reject('NO_RESULT');
            }
        })
        .catch(err => {
            if (err.statusCode === 503) {
                return Promise.reject('GOOGLE_CAPTCHA');
            }
            return Promise.reject(err);
        });
}

function getAlbumInfo(title, artist) {
    return request(
        `http://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${API_KEY}&track=${title}&artist=${artist}&format=json`
    ).then(res => {
        const { track } = JSON.parse(res);

        const { url } = track;

        return request(url);
    })
    .then(body => {
        const $ = cheerio.load(body);

        const albumName = $('.featured-item-name').children().first().text();

        const albumImageSmallUrl = $('.cover-art').attr('src');

        const albumImageSmallUrlSplitted = albumImageSmallUrl.split('/');

        const albumImageId = albumImageSmallUrlSplitted[albumImageSmallUrlSplitted.length - 1];

        const albumImageUrl = `https://lastfm-img2.akamaized.net/i/u/ar0/${albumImageId}`;

        return Promise.resolve({
            albumName,
            albumImageUrl,
            albumImageId
        });
    })
    .catch(err => {
        return Promise.reject(err);
    });
}

module.exports = main;
