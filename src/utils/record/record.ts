import { getOption } from '../../../types/options'
import type { RecordInfo } from '../../../types/record_info'
import { getStreamInfo } from '../stream_info'
import { getRecordInfo, setRecordInfo } from './record_info_helper'

/**
 * 사용자의 Chrome 버전을 User-Agent 문자열에서 추출합니다.
 *
 * @returns Chrome 버전
 */
const getChromeVersion = (): number | false => {
  const raw = navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)

  return (raw != null) ? parseInt(raw[2], 10) : false
}

const isMoz = navigator.userAgent.includes('Firefox')

/**
 * 녹화 기능에서 MP4로 녹화 여부를 확인합니다.
 * (Chrome 128 이상, video/mp4;codecs=avc1,mp4a.40.2 지원 여부, 사용자 설정)
 *
 * @returns MP4 녹화 지원 여부
 */
const checkMP4 = async (): Promise<boolean> => {
  const isAboveChrome128 = Number(getChromeVersion()) >= 128
  const isSupportMP4 = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')
  const preferMP4 = (await getOption()).preferMP4

  return isSupportMP4 && isAboveChrome128 && preferMP4
}

/**
 * 녹화를 시작합니다.
 *
 * @param video 녹화할 비디오 element
 * @returns MediaRecorder
 */
export async function startRecord (video: HTMLVideoElement): Promise<MediaRecorder | null> {
  const streamInfo = getStreamInfo(document)
  const stream = isMoz ? video.mozCaptureStream() : video.captureStream()

  const videoBitsPerSecond = (await getOption()).videoBitsPerSecond
  const isMP4 = await checkMP4()
  const recorder = new MediaRecorder(stream, {
    mimeType:
    isMP4
      ? 'video/mp4;codecs=avc1,mp4a.40.2'
      : isMoz
        ? 'video/webm'
        : 'video/webm;codecs=avc1',
    videoBitsPerSecond
  })

  recorder.recordInfo = {
    startDateTime: new Date().getTime(),
    stopDateTime: -1,
    resultBlobURL: '',
    streamInfo,
    isMP4
  }
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return

    if (recorder.recordInfo === undefined) {
      return
    }

    recorder.recordInfo.resultBlobURL = URL.createObjectURL(event.data)
  }

  recorder.start()
  return recorder
}

/**
 * 고프레임 녹화를 시작합니다.
 *
 * @param video 녹화할 비디오 element
 * @returns [MediaRecorder, Canvas Interval]
 */
export async function startHighFrameRateRecord (video: HTMLVideoElement): Promise<readonly [MediaRecorder, number] | null> {
  const streamInfo = getStreamInfo(document)
  const isMP4 = await checkMP4()
  const videoBitsPerSecond = (await getOption()).videoBitsPerSecond

  // video.captureStream()으로는 프레임 설정이 불가능해, 60프레임으로 녹화하기가 어려움.
  // 이를 위해 1초에 60번씩 영상의 화면을 그리는 canvas를 생성하고,
  // 프레임 설정을 지원하는 canvas.catprueStream()을 사용하여 녹화를 진행
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (ctx === null) {
    return null
  }

  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  const highFrameRateCanvasInteval = window.setInterval(() => {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  }, 1000 / 60) // 60fps

  const videoStream = canvas.captureStream(60) // 60fps
  const recordingStream = new MediaStream() // 실제 녹화하는 스트림

  videoStream.getVideoTracks().forEach(track => {
    recordingStream.addTrack(track)
  }) // 비디오 트랙 추가

  // cavnas 스트림은 오디오를 포함하지 않으므로, 원본 비디오의 오디오 트랙 추가
  recordingStream.addTrack(video.captureStream().getAudioTracks()[0])
  const newRecordInfo: RecordInfo = {
    startDateTime: new Date().getTime(),
    stopDateTime: -1,
    resultBlobURL: '',
    streamInfo,
    isMP4
  }

  const videoRecorder = new MediaRecorder(
    recordingStream,
    {
      mimeType:
        isMP4
          ? 'video/mp4;codecs=avc1,mp4a.40.2'
          : isMoz
            ? 'video/webm'
            : 'video/webm;codecs=avc1',
      videoBitsPerSecond
    }
  )
  videoRecorder.recordInfo = newRecordInfo
  videoRecorder.ondataavailable = (event) => {
    if (event.data.size === 0) return

    if (videoRecorder.recordInfo === undefined) {
      return
    }

    videoRecorder.recordInfo.resultBlobURL = URL.createObjectURL(event.data)
  }
  videoRecorder.start()
  await setRecordInfo(newRecordInfo)

  return [videoRecorder, highFrameRateCanvasInteval] as const
}

/**
 * MediaRecorder를 중지합니다.
 * MediaRecorder의 stop 메서드를 호출하고, 녹화 정보를 stroage에 저장합니다.
 *
 * @param recorder 녹화에 사용된 MediaRecorder
 * @returns 녹화본 RecordInfo
 */
export async function stopRecord (recorder: MediaRecorder): Promise<RecordInfo> {
  recorder.stop()

  await new Promise((resolve) => {
    recorder.onstop = async () => {
      const info = recorder.recordInfo

      if (info === undefined) {
        return
      }

      info.stopDateTime = new Date().getTime()

      await setRecordInfo(info)
      resolve(null)
    }
  })

  return await getRecordInfo()
}
