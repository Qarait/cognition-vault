declare module 'adm-zip' {
    class AdmZip {
        constructor(fileNameOrBuffer?: string | Buffer)
        getEntries(): AdmZip.IZipEntry[]
        addFile(entryName: string, content: Buffer): void
        writeZip(targetFile: string): void
    }
    namespace AdmZip {
        interface IZipEntry {
            entryName: string
            isDirectory: boolean
            header: {
                size: number
                compressedSize: number
            }
            getData(): Buffer
        }
    }
    export = AdmZip
}
