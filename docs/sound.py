import asyncio
import sounddevice as sd
import numpy as np
from hume import HumeClient

# --- НАСТРОЙКИ ---
API_KEY = "API"
SAMPLE_RATE = 16000  # ИИ лучше всего понимает 16кГц
CHANNELS = 1

async def stream_analysis():
    client = HumeClient(api_key=API_KEY)
    
    print("\n[Стрим] Подключение к Hume AI...")
    # Открываем защищенное соединение для передачи аудио
    async with client.expression_measurement.stream.connect(models={"prosody": {}}) as socket:
        print("[OK] Соединение установлено. ГОВОРИТЕ (5 секунд)...")
        
        # Функция-колбэк для захвата звука
        def callback(indata, frames, time, status):
            # Отправляем аудио-данные в сокет
            asyncio.run_coroutine_threadsafe(socket.send_audio(indata.copy()), loop)

        loop = asyncio.get_event_loop()
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, callback=callback):
            # Ждем 5 секунд записи
            await asyncio.sleep(5)
            
        print("[ИИ] Завершение стрима и получение финального отчета...")
        result = await socket.get_result()
        
        # Вывод результатов
        emotions = result.prosody.predictions[0].emotions
        top_3 = sorted(emotions, key=lambda x: x.score, reverse=True)[:3]
        
        print("\n=== ВАШЕ СОСТОЯНИЕ В РЕАЛЬНОМ ВРЕМЕНИ ===")
        for e in top_3:
            print(f"  • {e.name:15} | {round(e.score, 3)}")

if __name__ == "__main__":
    try:
        asyncio.run(stream_analysis())
    except Exception as e:
        print(f"Ошибка стриминга: {e}")