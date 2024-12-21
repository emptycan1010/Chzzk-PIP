import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

import RecIcon from '../../static/rec.svg?react'
import { useShortcut } from '../utils/hooks'
import { startHighFrameRateRecord, startRecord, stopRecord } from '../utils/record/record'
import { RecordOverlayPortal } from './rec_overlay'
import { getKeyBindings, getOption } from '../../types/options'
import { sanitizeFileName } from '../utils/record/save'

export function RecordPortal ({ tg }: { tg: Element | undefined }): React.ReactNode {
  if (tg === undefined) {
    return null
  }

  const div = document.createElement('div')
  div.id = 'chzzk-pip-rec-button'

  tg.insertBefore(div, tg.firstChild)
  return ReactDOM.createPortal(<RecordButton />, div)
}

/**
 * 영상 녹화를 중지하는 함수입니다.
 *
 * @param recorder 녹화에 사용된 MediaRecorder Ref
 * @param fastRec '영상 빠른 저장' 기능 사용 여부
 * @returns
 */
async function _stopRecord (
  recorder: React.MutableRefObject<MediaRecorder | undefined>,
  fastRec: boolean
): Promise<void> {
  if (recorder.current === undefined) {
    return
  }

  const info = await stopRecord(recorder.current)
  recorder.current = undefined

  if (info.resultBlobURL === '') {
    return
  }

  // '영상 빠른 저장' 기능 사용시, 결과 페이지 표시 없이 즉시 다운
  if (fastRec) {
    const video = document.createElement('video')
    video.src = info.resultBlobURL
    video.preload = 'metadata'

    video.onloadedmetadata = () => {
      (async (): Promise<void> => {
        let duration: number = 0

        video.currentTime = Number.MAX_SAFE_INTEGER
        await new Promise(resolve => setTimeout(resolve, 500))
        video.currentTime = 0

        duration = video.duration

        // video.duration이 Infinity일 경우, 녹화 시작 시간과 종료 시간을 이용하여 대략적인 계산
        if (duration === Infinity) {
          duration = (info.stopDateTime - info.startDateTime) / 1000 - 0.1
        }

        const fileName = `${info.streamInfo.streamerName}_${duration.toFixed(2)}s`

        // 다운로드
        const a = document.createElement('a')
        a.href = info.resultBlobURL
        a.download = sanitizeFileName(`${fileName}.${info.isMP4 ? 'mp4' : 'webm'}`)

        a.click()

        URL.revokeObjectURL(info.resultBlobURL)
      })()
        .catch(console.error)
    }
    return
  }

  // '영상 빠른 저장' 미사용시 결과 페이지 표시
  window.open(chrome.runtime.getURL('/pages/record_result/index.html'))
}

/**
 * RecordButton component
 *
 * 녹화 버튼 컴포넌트입니다.
 */
function RecordButton (): React.ReactNode {
  const [isRecording, setIsRecording] = useState(false)
  const fastRec = useRef(false)
  const highFrameRateRec = useRef(false)

  const recorder = useRef<MediaRecorder>() // 녹화에 사용된 MediaRecorder
  const canvasInterval = useRef<number>() // 고프레임 녹화에 사용된 canvas interval

  useEffect(() => {
    return () => {
      if (isRecording) {
        window.clearInterval(canvasInterval.current)

        _stopRecord(recorder, fastRec.current)
          .catch(console.error)
      }
    }
  }, [isRecording, fastRec])

  useEffect(() => {
    getOption()
      .then((opt) => {
        fastRec.current = opt.fastRec
        highFrameRateRec.current = opt.highFrameRateRec
      })
      .catch(console.error)
  }, [])

  const [key, setKey] = useState<string>('')

  useEffect(() => {
    getKeyBindings()
      .then((k) => { setKey(k.rec) })
      .catch(console.error)
  }, [])

  useShortcut(key, () => { clickHandler().catch(console.error) })

  const clickHandler = async (): Promise<void> => {
    const video: HTMLVideoElement | null = document.querySelector('.webplayer-internal-video')
    if (video === null) {
      return
    }

    // 방송 종료 시 자동 녹화 종료
    video.onended = () => {
      setIsRecording(false)
    }

    if (video.muted) {
      alert('음소거된 비디오는 녹화할 수 없습니다.')
      return
    }

    const newRec = !isRecording
    setIsRecording(newRec)

    // 녹화 시작
    if (newRec) {
      // 고프레임 녹화 시
      if (highFrameRateRec.current) {
        const [_videoRecorder, _canvasInterval] = await startHighFrameRateRecord(video) ?? [null, null, null]

        if (_videoRecorder === null || _canvasInterval === null) {
          return
        }

        recorder.current = _videoRecorder
        canvasInterval.current = _canvasInterval
      } else { // 일반 녹화 시
        const _recorder = await startRecord(video)

        if (_recorder === null) {
          return
        }
        recorder.current = _recorder
      }

      return
    }

    // 녹화 중지
    if ((recorder.current?.recordInfo?.highFrameRec) ?? false) {
      if (recorder.current === undefined || canvasInterval.current === undefined) {
        return
      }
      clearInterval(canvasInterval.current) // 고프레임 녹화 canvas interval 제거
    }
    await _stopRecord(recorder, fastRec.current)
  }

  return (
    <>
      <button
        className='pzp-button pzp-pc-setting-button pzp-pc__setting-button pzp-pc-ui-button chzzk-record-button'
        onClick={() => { clickHandler().catch(console.error) }}
      >
        <span className='pzp-button__tooltip pzp-button__tooltip--top'>
          {isRecording ? '녹화 중지' : '녹화'} ({key})
        </span>
        <span className='pzp-ui-icon pzp-pc-setting-button__icon'>
          <RecIcon fill={isRecording ? 'red' : 'white'} />
        </span>
      </button>
      {isRecording && <RecordOverlayPortal />}
    </>
  )
}
