import fs from 'fs'

const writeStreamOptions = {
  encoding: 'utf8' as const,
}

function getFileSyncSize(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

export class RotatingWriteStream {
  private writeStream!: fs.WriteStream
  private size = 0
  private rotatePromise: Promise<void> | undefined
  private drainPromise: Promise<void> | undefined

  constructor(
    private readonly file: string,
    private readonly sizeLimit: number,
    private readonly flags: 'a' | 'w'
  ) {
    this.createWriteStream()
    // In append mode the file may already hold content from a previous
    // session or process, so seed the counter to keep rotation accurate.
    this.size = flags === 'a' ? getFileSyncSize(file) : 0
  }

  private createWriteStream() {
    this.writeStream = fs.createWriteStream(this.file, {
      ...writeStreamOptions,
      flags: this.flags,
    })
  }

  private async rotate() {
    await this.end()
    try {
      fs.unlinkSync(this.file)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
    this.size = 0
    this.createWriteStream()
    this.rotatePromise = undefined
  }

  async write(data: string): Promise<void> {
    if (this.rotatePromise) {
      await this.rotatePromise
    }

    this.size += data.length
    if (this.size > this.sizeLimit) {
      await (this.rotatePromise = this.rotate())
    }

    if (!this.writeStream.write(data, 'utf8')) {
      if (this.drainPromise === undefined) {
        this.drainPromise = new Promise<void>((resolve) => {
          this.writeStream.once('drain', () => {
            this.drainPromise = undefined
            resolve()
          })
        })
      }
      await this.drainPromise
    }
  }

  flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writeStream.write('', 'utf8', (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  end(): Promise<void> {
    return new Promise((resolve) => {
      this.writeStream.end(resolve)
    })
  }
}
