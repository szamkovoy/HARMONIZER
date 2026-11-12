-- Диагностика, консультация, целительная сессия.
-- Разовая оплата с лендинга. Сумма в рублях — с карточки Lava (её же берёт ЮKassa).
-- EUR/USD читаются из Lava по offer id. Тариф приложения не меняется,
-- пропуск на вебинары не выдаётся, в кабинет приложения продукты не выводятся.

alter table public.payment_catalog drop constraint if exists payment_catalog_tier_check;
alter table public.payment_catalog
  add constraint payment_catalog_tier_check
  check (tier in (
    'oracle', 'master', 'webinar', 'webinar_pack', 'book',
    'spb_practicum', 'surcharge', 'yoga_course',
    'diagnostics', 'consultation', 'healing_session'
  ));

alter table public.payment_contracts drop constraint if exists payment_contracts_tier_check;
alter table public.payment_contracts
  add constraint payment_contracts_tier_check
  check (tier in (
    'oracle', 'master', 'webinar', 'webinar_pack', 'book',
    'spb_practicum', 'surcharge', 'yoga_course',
    'diagnostics', 'consultation', 'healing_session'
  ));

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind, lava_offer_id,
   webinar_credits, webinar_window_days, sort_order, letter_subject_i18n, letter_body_i18n)
values (
  'yookassa',
  'diagnostics',
  'RUB',
  3000,
  'Диагностика',
  'Диагностика',
  'one_time',
  '282eb496-d561-49e2-8efc-5a14ad8a42f2',
  null,
  null,
  90,
  jsonb_build_object(
    'ru', 'Вопросы для диагностики',
    'en', 'Questions for the diagnostic',
    'de', 'Fragen für die Diagnostik',
    'fr', 'Questions pour le diagnostic',
    'it', 'Domande per la diagnosi',
    'es', 'Preguntas para el diagnóstico',
    'pt', 'Perguntas para o diagnóstico',
    'nl', 'Vragen voor de diagnostiek'
  ),
  jsonb_build_object(
    'ru', $ru$Здравствуйте, {{name}}!

Благодарю вас за запись на диагностику.

Для проведения диагностики, пожалуйста, ответьте на следующие вопросы:

1. Сообщите мне номер телефона с которым связан ваш аккаунт в WhatsApp или в Telegram или в Max - на который вам будет удобно принять моё голосовое сообщение с рекомендациями по диагностике.

2. Сколько вам лет и где вы живёте?

3. В трёх предложениях расскажите о себе самое главное.

4. В какой физической форме ваше тело? Какой рост, вес? Что хотелось бы улучшить?

5. Есть ли у вас хронические заболевания или неприятные ощущения в теле?

6. Какие методы лечения (оздоравливания) вы пробовали? С какими результатами?

7. Здоровое ли ваше питание? Сколько раз в день вы кушаете, в какое время?

8. Вы занимаетесь спортом? Каким? Как часто? Какова ваша физическая активность?

9. Во сколько вы ложитесь, просыпаетесь? Глубок ли ваш сон?

10. Опишите как обычно проходит ваш обычный день.

11. Какие жизненные задачи (проблемы) в данный момент для вас наиболее актуальны?

12. Какая задача (проблема) подтолкнула вас записаться на эту диагностику (то есть из перечисленного выше что наиболее срезонировало)?

13. Опишите (поконкретней), как изменится ваша жизнь, когда вы решите эту задачу.

14. Что и где именно в теле вы ощущаете, представляя себя решившим эту задачу?

15. Представьте, что эту задачу вы не решите никогда. Где и какие ощущения в теле?

16. Какие психологические и духовные курсы, практики, направления вы примеряли?

С уважением,
Сергей Замковой$ru$,
    'en', $en$Hello, {{name}}!

Thank you for signing up for the diagnostic.

To carry it out, please answer the following questions:

1. Please send me the phone number linked to your WhatsApp, Telegram, or Max account — whichever is convenient for you to receive my voice message with recommendations from the diagnostic.

2. How old are you, and where do you live?

3. In three sentences, tell me the most important things about yourself.

4. What physical shape is your body in? What are your height and weight? What would you like to improve?

5. Do you have any chronic conditions or unpleasant sensations in your body?

6. What methods of treatment (healing) have you tried? With what results?

7. Is your diet healthy? How many times a day do you eat, and at what times?

8. Do you do any sport? Which one? How often? What is your physical activity like?

9. What time do you go to bed and wake up? Is your sleep deep?

10. Describe how an ordinary day usually goes for you.

11. Which life tasks (problems) are most relevant for you right now?

12. Which task (problem) prompted you to sign up for this diagnostic (that is, which of the above resonated most)?

13. Describe more specifically how your life will change when you resolve this task.

14. What do you feel in your body, and where exactly, when you imagine yourself having resolved this task?

15. Imagine that you never resolve this task. Where in your body do you feel it, and what are the sensations?

16. Which psychological and spiritual courses, practices, and paths have you tried?

Kind regards,
Sergei Zamkovoi$en$,
    'de', $de$Guten Tag, {{name}}!

vielen Dank, dass Sie sich für die Diagnostik angemeldet haben.

Für die Durchführung beantworten Sie bitte die folgenden Fragen:

1. Nennen Sie mir bitte die Telefonnummer, die mit Ihrem Konto bei WhatsApp, Telegram oder Max verbunden ist — die, über die Sie meine Sprachnachricht mit den Empfehlungen aus der Diagnostik bequem empfangen können.

2. Wie alt sind Sie und wo leben Sie?

3. Erzählen Sie in drei Sätzen das Wichtigste über sich.

4. In welcher körperlichen Verfassung ist Ihr Körper? Wie groß sind Sie, wie viel wiegen Sie? Was möchten Sie verbessern?

5. Haben Sie chronische Erkrankungen oder unangenehme Empfindungen im Körper?

6. Welche Behandlungsmethoden (Methoden der Gesundung) haben Sie ausprobiert? Mit welchem Ergebnis?

7. Ist Ihre Ernährung gesund? Wie oft am Tag essen Sie, und zu welcher Uhrzeit?

8. Treiben Sie Sport? Welchen? Wie oft? Wie sieht Ihre körperliche Aktivität aus?

9. Um wie viel Uhr gehen Sie schlafen und wachen Sie auf? Ist Ihr Schlaf tief?

10. Beschreiben Sie, wie ein gewöhnlicher Tag bei Ihnen üblicherweise verläuft.

11. Welche Lebensaufgaben (Probleme) sind für Sie im Moment am wichtigsten?

12. Welche Aufgabe (welches Problem) hat Sie dazu gebracht, sich für diese Diagnostik anzumelden (also: was von dem oben Genannten hat am stärksten Resonanz ausgelöst)?

13. Beschreiben Sie möglichst konkret, wie sich Ihr Leben verändert, wenn Sie diese Aufgabe gelöst haben.

14. Was spüren Sie im Körper, und wo genau, wenn Sie sich vorstellen, diese Aufgabe gelöst zu haben?

15. Stellen Sie sich vor, Sie lösen diese Aufgabe niemals. Wo im Körper spüren Sie das, und welche Empfindungen sind es?

16. Welche psychologischen und spirituellen Kurse, Praktiken und Richtungen haben Sie ausprobiert?

Mit freundlichen Grüßen
Sergei Zamkovoi$de$,
    'fr', $fr$Bonjour {{name}},

je vous remercie pour votre inscription au diagnostic.

Pour que je puisse le réaliser, merci de répondre aux questions suivantes :

1. Indiquez-moi le numéro de téléphone lié à votre compte WhatsApp, Telegram ou Max — celui sur lequel vous pourrez facilement recevoir mon message vocal avec les recommandations issues du diagnostic.

2. Quel âge avez-vous et où vivez-vous ?

3. En trois phrases, dites l'essentiel sur vous.

4. Dans quelle forme physique est votre corps ? Quelle est votre taille, votre poids ? Qu'aimeriez-vous améliorer ?

5. Avez-vous des maladies chroniques ou des sensations désagréables dans le corps ?

6. Quelles méthodes de traitement (de mieux-être) avez-vous essayées ? Avec quels résultats ?

7. Votre alimentation est-elle saine ? Combien de fois par jour mangez-vous, et à quelle heure ?

8. Faites-vous du sport ? Lequel ? À quelle fréquence ? Quelle est votre activité physique ?

9. À quelle heure vous couchez-vous et vous réveillez-vous ? Votre sommeil est-il profond ?

10. Décrivez comment se passe d'ordinaire une journée habituelle pour vous.

11. Quelles tâches de vie (problèmes) sont les plus actuelles pour vous en ce moment ?

12. Quelle tâche (quel problème) vous a poussé à vous inscrire à ce diagnostic (c'est-à-dire, parmi ce qui précède, ce qui a le plus résonné) ?

13. Décrivez plus concrètement comment votre vie changera lorsque vous aurez résolu cette tâche.

14. Que ressentez-vous dans le corps, et où exactement, en vous imaginant ayant résolu cette tâche ?

15. Imaginez que vous ne résolviez jamais cette tâche. Où dans le corps, et quelles sensations ?

16. Quels cours, pratiques et courants psychologiques et spirituels avez-vous essayés ?

Cordialement,
Sergei Zamkovoi$fr$,
    'it', $it$Buongiorno {{name}},

la ringrazio per l'iscrizione alla diagnosi.

Per poterla svolgere, la prego di rispondere alle seguenti domande:

1. Mi indichi il numero di telefono collegato al suo account WhatsApp, Telegram o Max: quello su cui le è comodo ricevere il mio messaggio vocale con i consigli emersi dalla diagnosi.

2. Quanti anni ha e dove vive?

3. In tre frasi mi dica l'essenziale di sé.

4. In che forma fisica è il suo corpo? Quali sono altezza e peso? Che cosa vorrebbe migliorare?

5. Ha malattie croniche o sensazioni sgradevoli nel corpo?

6. Quali metodi di cura (di risanamento) ha provato? Con quali risultati?

7. La sua alimentazione è sana? Quante volte al giorno mangia, e a che ora?

8. Fa sport? Quale? Con che frequenza? Com'è la sua attività fisica?

9. A che ora va a dormire e si sveglia? Il suo sonno è profondo?

10. Descriva come si svolge di solito una sua giornata ordinaria.

11. Quali compiti di vita (problemi) sono per lei più attuali in questo momento?

12. Quale compito (problema) l'ha spinta a iscriversi a questa diagnosi (cioè, tra quelli indicati sopra, quale ha risuonato di più)?

13. Descriva in modo più concreto come cambierà la sua vita quando avrà risolto questo compito.

14. Che cosa sente nel corpo, e dove esattamente, immaginandosi dopo aver risolto questo compito?

15. Immagini di non risolvere mai questo compito. Dove nel corpo, e quali sensazioni?

16. Quali corsi, pratiche e indirizzi psicologici e spirituali ha provato?

Cordiali saluti,
Sergei Zamkovoi$it$,
    'es', $es$Hola, {{name}}:

gracias por apuntarte al diagnóstico.

Para poder hacerlo, responde, por favor, a las siguientes preguntas:

1. Dime el número de teléfono vinculado a tu cuenta de WhatsApp, Telegram o Max: aquel en el que te resulte cómodo recibir mi mensaje de voz con las recomendaciones del diagnóstico.

2. ¿Cuántos años tienes y dónde vives?

3. En tres frases, cuenta lo más importante sobre ti.

4. ¿En qué forma física está tu cuerpo? ¿Cuál es tu estatura y tu peso? ¿Qué te gustaría mejorar?

5. ¿Tienes enfermedades crónicas o sensaciones desagradables en el cuerpo?

6. ¿Qué métodos de tratamiento (de sanación) has probado? ¿Con qué resultados?

7. ¿Tu alimentación es sana? ¿Cuántas veces al día comes y a qué hora?

8. ¿Haces deporte? ¿Cuál? ¿Con qué frecuencia? ¿Cómo es tu actividad física?

9. ¿A qué hora te acuestas y te despiertas? ¿Tu sueño es profundo?

10. Describe cómo suele transcurrir un día normal para ti.

11. ¿Qué tareas vitales (problemas) son ahora las más actuales para ti?

12. ¿Qué tarea (problema) te impulsó a apuntarte a este diagnóstico (es decir, de lo anterior, qué resonó más)?

13. Describe con más concreción cómo cambiará tu vida cuando resuelvas esta tarea.

14. ¿Qué sientes en el cuerpo, y dónde exactamente, al imaginarte habiendo resuelto esta tarea?

15. Imagina que nunca resuelves esta tarea. ¿Dónde en el cuerpo, y qué sensaciones?

16. ¿Qué cursos, prácticas y corrientes psicológicas y espirituales has probado?

Un saludo,
Sergei Zamkovoi$es$,
    'pt', $pt$Olá, {{name}}!

Obrigado por se inscrever no diagnóstico.

Para o realizar, responda, por favor, às seguintes perguntas:

1. Indique-me o número de telefone associado à sua conta de WhatsApp, Telegram ou Max — aquele em que lhe for cómodo receber a minha mensagem de voz com as recomendações do diagnóstico.

2. Quantos anos tem e onde vive?

3. Em três frases, conte o mais importante sobre si.

4. Em que forma física está o seu corpo? Qual é a sua altura e o seu peso? O que gostaria de melhorar?

5. Tem doenças crónicas ou sensações desagradáveis no corpo?

6. Que métodos de tratamento (de cura) experimentou? Com que resultados?

7. A sua alimentação é saudável? Quantas vezes por dia come, e a que horas?

8. Pratica desporto? Qual? Com que frequência? Como é a sua atividade física?

9. A que horas se deita e acorda? O seu sono é profundo?

10. Descreva como costuma decorrer um dia normal para si.

11. Que tarefas de vida (problemas) são neste momento as mais atuais para si?

12. Que tarefa (problema) o levou a inscrever-se neste diagnóstico (ou seja, do que enumerou acima, o que mais ressoou)?

13. Descreva de forma mais concreta como a sua vida vai mudar quando resolver esta tarefa.

14. O que sente no corpo, e onde exatamente, ao imaginar-se tendo resolvido esta tarefa?

15. Imagine que nunca resolve esta tarefa. Onde no corpo, e que sensações?

16. Que cursos, práticas e correntes psicológicas e espirituais experimentou?

Com os melhores cumprimentos,
Sergei Zamkovoi$pt$,
    'nl', $nl$Hallo {{name}},

dank je wel voor je aanmelding voor de diagnostiek.

Om die te kunnen doen, beantwoord alsjeblieft de volgende vragen:

1. Stuur me het telefoonnummer dat aan je account op WhatsApp, Telegram of Max is gekoppeld — het nummer waarop je mijn spraakbericht met de aanbevelingen uit de diagnostiek gemakkelijk kunt ontvangen.

2. Hoe oud ben je en waar woon je?

3. Vertel in drie zinnen het belangrijkste over jezelf.

4. In welke lichamelijke conditie is je lichaam? Wat zijn je lengte en gewicht? Wat zou je willen verbeteren?

5. Heb je chronische aandoeningen of onaangename sensaties in je lichaam?

6. Welke behandelmethoden (manieren van herstel) heb je geprobeerd? Met welk resultaat?

7. Is je voeding gezond? Hoe vaak per dag eet je, en op welke tijden?

8. Doe je aan sport? Welke? Hoe vaak? Hoe ziet je lichamelijke activiteit eruit?

9. Hoe laat ga je naar bed en word je wakker? Is je slaap diep?

10. Beschrijf hoe een gewone dag bij jou meestal verloopt.

11. Welke levenstaken (problemen) zijn op dit moment het meest actueel voor je?

12. Welke taak (welk probleem) bracht je ertoe je voor deze diagnostiek aan te melden (dus: wat van het bovenstaande resoneerde het sterkst)?

13. Beschrijf concreter hoe je leven verandert wanneer je deze taak oplost.

14. Wat voel je in je lichaam, en waar precies, als je je voorstelt dat je deze taak hebt opgelost?

15. Stel je voor dat je deze taak nooit oplost. Waar in het lichaam, en welke sensaties?

16. Welke psychologische en spirituele cursussen, praktijken en richtingen heb je geprobeerd?

Met vriendelijke groet,
Sergei Zamkovoi$nl$
  )
)
on conflict (provider, tier, currency) do update
set amount = excluded.amount,
    title = excluded.title,
    description = excluded.description,
    product_kind = excluded.product_kind,
    lava_offer_id = excluded.lava_offer_id,
    webinar_credits = null,
    webinar_window_days = null,
    sort_order = excluded.sort_order,
    letter_subject_i18n = excluded.letter_subject_i18n,
    letter_body_i18n = excluded.letter_body_i18n,
    active = true,
    updated_at = now();

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind, lava_offer_id,
   webinar_credits, webinar_window_days, sort_order, letter_subject_i18n, letter_body_i18n)
values (
  'yookassa',
  'consultation',
  'RUB',
  10000,
  'Консультация',
  'Консультация',
  'one_time',
  '59afc5fe-c9b1-45e6-aea9-fe4a91cf7e6d',
  null,
  null,
  100,
  jsonb_build_object(
    'ru', 'Согласование времени консультации',
    'en', 'Scheduling the consultation',
    'de', 'Terminabstimmung für die Beratung',
    'fr', 'Accord sur l''horaire de la consultation',
    'it', 'Accordo sull''orario della consulenza',
    'es', 'Acordar la hora de la consulta',
    'pt', 'Acordo da hora da consulta',
    'nl', 'Tijd afstemmen voor het consult'
  ),
  jsonb_build_object(
    'ru', $ru$Здравствуйте, {{name}}!

Благодарю вас за запись на консультацию. Укажите, пожалуйста, несколько вариантов (дата/время) которые вам удобны для нашей встречи. Чтобы мы друг друга однозначно поняли, укажите время в часовом поясе Москвы (GMT +3).

А также скажите - понадобится ли вам видеозапись нашей встречи? Я должен знать это заранее, чтобы в Zoom (где пройдет наша встреча), включить запись. В этом случае, после консультации, я пришлю вам ссылку на скачивание видеофайла этой записи. А через неделю я удалю этот файл из Zoom, чтобы он нигде не хранился, кроме как у вас. Я рекомендую вам воспользоваться этой возможностью, так как на консультации мы можем затрагивать темы, которые чудесным образом будут быстро забываться (так работают защитные механизмы психики), а также обсуждать практики, которые в дальнейшем у вас может возникнуть необходимость пересмотреть.

С уважением,
Сергей Замковой$ru$,
    'en', $en$Hello, {{name}}!

Thank you for signing up for a consultation. Please suggest several options (date/time) that suit you for our meeting. So that we understand each other without any ambiguity, please give the time in the Moscow time zone (GMT +3).

Please also tell me whether you will need a video recording of our meeting. I need to know this in advance so that I can turn recording on in Zoom (where our meeting will take place). In that case, after the consultation I will send you a link to download the video file of this recording. A week later I will delete this file from Zoom, so that it is not stored anywhere except with you. I recommend using this option, because in a consultation we may touch on topics that, strangely enough, are quickly forgotten (that is how the mind's defenses work), and we may also discuss practices that you may later need to revisit.

Kind regards,
Sergei Zamkovoi$en$,
    'de', $de$Guten Tag, {{name}}!

vielen Dank, dass Sie sich für eine Beratung angemeldet haben. Nennen Sie mir bitte mehrere Varianten (Datum/Uhrzeit), die Ihnen für unser Treffen passen. Damit wir einander eindeutig verstehen, geben Sie die Zeit bitte in der Zeitzone von Moskau an (GMT +3).

Sagen Sie mir bitte auch, ob Sie eine Videoaufzeichnung unseres Treffens benötigen. Das muss ich im Voraus wissen, damit ich in Zoom (wo unser Treffen stattfindet) die Aufzeichnung einschalten kann. In diesem Fall schicke ich Ihnen nach der Beratung einen Link zum Herunterladen der Videodatei dieser Aufzeichnung. Eine Woche später lösche ich diese Datei aus Zoom, damit sie nirgendwo gespeichert bleibt außer bei Ihnen. Ich empfehle, diese Möglichkeit zu nutzen, denn in der Beratung können wir Themen berühren, die auf merkwürdige Weise schnell vergessen werden (so arbeiten die Schutzmechanismen der Psyche), und auch Praktiken besprechen, die Sie später möglicherweise noch einmal ansehen möchten.

Mit freundlichen Grüßen
Sergei Zamkovoi$de$,
    'fr', $fr$Bonjour {{name}},

je vous remercie pour votre inscription à la consultation. Indiquez-moi, s'il vous plaît, plusieurs options (date/heure) qui vous conviennent pour notre rencontre. Pour que nous nous comprenions sans ambiguïté, indiquez l'heure dans le fuseau de Moscou (GMT +3).

Dites-moi aussi si vous aurez besoin d'un enregistrement vidéo de notre rencontre. Je dois le savoir à l'avance, afin d'activer l'enregistrement dans Zoom (où aura lieu notre rencontre). Dans ce cas, après la consultation, je vous enverrai un lien pour télécharger le fichier vidéo de cet enregistrement. Une semaine plus tard, je supprimerai ce fichier de Zoom, afin qu'il ne soit conservé nulle part ailleurs que chez vous. Je vous recommande d'utiliser cette possibilité, car lors de la consultation nous pouvons aborder des sujets qui, de façon étrange, s'oublient vite (c'est ainsi que fonctionnent les mécanismes de défense du psychisme), et aussi discuter de pratiques que vous pourriez avoir besoin de revoir plus tard.

Cordialement,
Sergei Zamkovoi$fr$,
    'it', $it$Buongiorno {{name}},

la ringrazio per l'iscrizione alla consulenza. Mi indichi, per favore, alcune opzioni (data/ora) che le sono comode per il nostro incontro. Perché ci capiamo senza ambiguità, indichi l'orario nel fuso di Mosca (GMT +3).

Mi dica anche se le servirà la registrazione video del nostro incontro. Devo saperlo in anticipo, per attivare la registrazione in Zoom (dove si svolgerà il nostro incontro). In questo caso, dopo la consulenza, le invierò un link per scaricare il file video di questa registrazione. Dopo una settimana cancellerò questo file da Zoom, così che non resti conservato da nessuna parte se non presso di lei. Le consiglio di usare questa possibilità, perché in consulenza possiamo toccare temi che, in modo sorprendente, si dimenticano in fretta (così funzionano i meccanismi di difesa della psiche), e anche discutere pratiche che in seguito potrebbe avere bisogno di rivedere.

Cordiali saluti,
Sergei Zamkovoi$it$,
    'es', $es$Hola, {{name}}:

gracias por apuntarte a la consulta. Indícame, por favor, varias opciones (fecha/hora) que te vengan bien para nuestro encuentro. Para que nos entendamos sin ambigüedad, indica la hora en la zona horaria de Moscú (GMT +3).

Dime también si necesitarás una grabación en vídeo de nuestro encuentro. Tengo que saberlo de antemano para activar la grabación en Zoom (donde tendrá lugar nuestro encuentro). En ese caso, después de la consulta, te enviaré un enlace para descargar el archivo de vídeo de esa grabación. Una semana después borraré ese archivo de Zoom, para que no quede guardado en ningún sitio salvo en tu poder. Te recomiendo usar esta posibilidad, porque en la consulta podemos tocar temas que, de un modo extraño, se olvidan enseguida (así funcionan los mecanismos de defensa de la psique), y también comentar prácticas que más adelante puedas necesitar volver a ver.

Un saludo,
Sergei Zamkovoi$es$,
    'pt', $pt$Olá, {{name}}!

Obrigado por se inscrever na consulta. Indique, por favor, algumas opções (data/hora) que lhe sejam convenientes para o nosso encontro. Para nos entendermos sem ambiguidade, indique a hora no fuso de Moscovo (GMT +3).

Diga-me também se vai precisar da gravação em vídeo do nosso encontro. Preciso de o saber antecipadamente, para ligar a gravação no Zoom (onde decorrerá o nosso encontro). Nesse caso, depois da consulta, envio-lhe uma ligação para descarregar o ficheiro de vídeo dessa gravação. Uma semana depois apago esse ficheiro do Zoom, para que não fique guardado em lado nenhum senão consigo. Recomendo que use esta possibilidade, porque na consulta podemos tocar em temas que, de um modo curioso, se esquecem depressa (é assim que funcionam os mecanismos de defesa da psique), e também falar de práticas que mais tarde possa precisar de rever.

Com os melhores cumprimentos,
Sergei Zamkovoi$pt$,
    'nl', $nl$Hallo {{name}},

dank je wel voor je aanmelding voor een consult. Geef alsjeblieft een paar opties (datum/tijd) die jou schikken voor onze ontmoeting. Zodat we elkaar eenduidig begrijpen, geef de tijd in de tijdzone van Moskou (GMT +3).

Zeg ook of je een video-opname van onze ontmoeting nodig hebt. Dat moet ik van tevoren weten, zodat ik in Zoom (waar onze ontmoeting plaatsvindt) de opname kan aanzetten. In dat geval stuur ik je na het consult een link om het videobestand van deze opname te downloaden. Een week later verwijder ik dit bestand uit Zoom, zodat het nergens bewaard blijft behalve bij jou. Ik raad je aan hiervan gebruik te maken, omdat we in een consult thema's kunnen aanraken die op een wonderlijke manier snel vergeten worden (zo werken de afweermechanismen van de psyche), en ook praktijken bespreken die je later misschien opnieuw wilt bekijken.

Met vriendelijke groet,
Sergei Zamkovoi$nl$
  )
)
on conflict (provider, tier, currency) do update
set amount = excluded.amount,
    title = excluded.title,
    description = excluded.description,
    product_kind = excluded.product_kind,
    lava_offer_id = excluded.lava_offer_id,
    webinar_credits = null,
    webinar_window_days = null,
    sort_order = excluded.sort_order,
    letter_subject_i18n = excluded.letter_subject_i18n,
    letter_body_i18n = excluded.letter_body_i18n,
    active = true,
    updated_at = now();

insert into public.payment_catalog
  (provider, tier, currency, amount, title, description, product_kind, lava_offer_id,
   webinar_credits, webinar_window_days, sort_order, letter_subject_i18n, letter_body_i18n)
values (
  'yookassa',
  'healing_session',
  'RUB',
  30000,
  'Целительная сессия',
  'Целительная сессия',
  'one_time',
  '5284f95f-0aa9-4220-bd46-e7e141527948',
  null,
  null,
  110,
  jsonb_build_object(
    'ru', 'Согласование времени целительной сессии',
    'en', 'Scheduling the healing session',
    'de', 'Terminabstimmung für die Heilungssitzung',
    'fr', 'Accord sur l''horaire de la séance de guérison',
    'it', 'Accordo sull''orario della sessione di guarigione',
    'es', 'Acordar la hora de la sesión de sanación',
    'pt', 'Acordo da hora da sessão de cura',
    'nl', 'Tijd afstemmen voor de healing-sessie'
  ),
  jsonb_build_object(
    'ru', $ru$Здравствуйте, {{name}}!

Благодарю вас за запись на целительную сессию. Укажите, пожалуйста, несколько вариантов (дата/время) которые вам удобны для нашей встречи. Чтобы мы друг друга однозначно поняли, укажите время в часовом поясе Москвы (GMT +3).

А также скажите - понадобится ли вам видеозапись нашей встречи? Я должен знать это заранее, чтобы в Zoom (где пройдет наша встреча), включить запись. В этом случае, после консультации, я пришлю вам ссылку на скачивание видеофайла этой записи. А через неделю я удалю этот файл из Zoom, чтобы он нигде не хранился, кроме как у вас. Я рекомендую вам воспользоваться этой возможностью, так как на консультации мы можем затрагивать темы, которые чудесным образом будут быстро забываться (так работают защитные механизмы психики), а также обсуждать и выполнять практики, которые в дальнейшем у вас может возникнуть необходимость пересмотреть.

С уважением,
Сергей Замковой$ru$,
    'en', $en$Hello, {{name}}!

Thank you for signing up for a healing session. Please suggest several options (date/time) that suit you for our meeting. So that we understand each other without any ambiguity, please give the time in the Moscow time zone (GMT +3).

Please also tell me whether you will need a video recording of our meeting. I need to know this in advance so that I can turn recording on in Zoom (where our meeting will take place). In that case, after the consultation, I will send you a link to download the video file of this recording. A week later I will delete this file from Zoom, so that it is not stored anywhere except with you. I recommend using this option, because in a consultation we may touch on topics that, strangely enough, are quickly forgotten (that is how the mind's defenses work), and we may also discuss and carry out practices that you may later need to revisit.

Kind regards,
Sergei Zamkovoi$en$,
    'de', $de$Guten Tag, {{name}}!

vielen Dank, dass Sie sich für eine Heilungssitzung angemeldet haben. Nennen Sie mir bitte mehrere Varianten (Datum/Uhrzeit), die Ihnen für unser Treffen passen. Damit wir einander eindeutig verstehen, geben Sie die Zeit bitte in der Zeitzone von Moskau an (GMT +3).

Sagen Sie mir bitte auch, ob Sie eine Videoaufzeichnung unseres Treffens benötigen. Das muss ich im Voraus wissen, damit ich in Zoom (wo unser Treffen stattfindet) die Aufzeichnung einschalten kann. In diesem Fall schicke ich Ihnen nach der Beratung einen Link zum Herunterladen der Videodatei dieser Aufzeichnung. Eine Woche später lösche ich diese Datei aus Zoom, damit sie nirgendwo gespeichert bleibt außer bei Ihnen. Ich empfehle, diese Möglichkeit zu nutzen, denn in der Beratung können wir Themen berühren, die auf merkwürdige Weise schnell vergessen werden (so arbeiten die Schutzmechanismen der Psyche), und auch Praktiken besprechen und ausführen, die Sie später möglicherweise noch einmal ansehen möchten.

Mit freundlichen Grüßen
Sergei Zamkovoi$de$,
    'fr', $fr$Bonjour {{name}},

je vous remercie pour votre inscription à la séance de guérison. Indiquez-moi, s'il vous plaît, plusieurs options (date/heure) qui vous conviennent pour notre rencontre. Pour que nous nous comprenions sans ambiguïté, indiquez l'heure dans le fuseau de Moscou (GMT +3).

Dites-moi aussi si vous aurez besoin d'un enregistrement vidéo de notre rencontre. Je dois le savoir à l'avance, afin d'activer l'enregistrement dans Zoom (où aura lieu notre rencontre). Dans ce cas, après la consultation, je vous enverrai un lien pour télécharger le fichier vidéo de cet enregistrement. Une semaine plus tard, je supprimerai ce fichier de Zoom, afin qu'il ne soit conservé nulle part ailleurs que chez vous. Je vous recommande d'utiliser cette possibilité, car lors de la consultation nous pouvons aborder des sujets qui, de façon étrange, s'oublient vite (c'est ainsi que fonctionnent les mécanismes de défense du psychisme), et aussi discuter et pratiquer des exercices que vous pourriez avoir besoin de revoir plus tard.

Cordialement,
Sergei Zamkovoi$fr$,
    'it', $it$Buongiorno {{name}},

la ringrazio per l'iscrizione alla sessione di guarigione. Mi indichi, per favore, alcune opzioni (data/ora) che le sono comode per il nostro incontro. Perché ci capiamo senza ambiguità, indichi l'orario nel fuso di Mosca (GMT +3).

Mi dica anche se le servirà la registrazione video del nostro incontro. Devo saperlo in anticipo, per attivare la registrazione in Zoom (dove si svolgerà il nostro incontro). In questo caso, dopo la consulenza, le invierò un link per scaricare il file video di questa registrazione. Dopo una settimana cancellerò questo file da Zoom, così che non resti conservato da nessuna parte se non presso di lei. Le consiglio di usare questa possibilità, perché in consulenza possiamo toccare temi che, in modo sorprendente, si dimenticano in fretta (così funzionano i meccanismi di difesa della psiche), e anche discutere ed eseguire pratiche che in seguito potrebbe avere bisogno di rivedere.

Cordiali saluti,
Sergei Zamkovoi$it$,
    'es', $es$Hola, {{name}}:

gracias por apuntarte a la sesión de sanación. Indícame, por favor, varias opciones (fecha/hora) que te vengan bien para nuestro encuentro. Para que nos entendamos sin ambigüedad, indica la hora en la zona horaria de Moscú (GMT +3).

Dime también si necesitarás una grabación en vídeo de nuestro encuentro. Tengo que saberlo de antemano para activar la grabación en Zoom (donde tendrá lugar nuestro encuentro). En ese caso, después de la consulta, te enviaré un enlace para descargar el archivo de vídeo de esa grabación. Una semana después borraré ese archivo de Zoom, para que no quede guardado en ningún sitio salvo en tu poder. Te recomiendo usar esta posibilidad, porque en la consulta podemos tocar temas que, de un modo extraño, se olvidan enseguida (así funcionan los mecanismos de defensa de la psique), y también comentar y realizar prácticas que más adelante puedas necesitar volver a ver.

Un saludo,
Sergei Zamkovoi$es$,
    'pt', $pt$Olá, {{name}}!

Obrigado por se inscrever na sessão de cura. Indique, por favor, algumas opções (data/hora) que lhe sejam convenientes para o nosso encontro. Para nos entendermos sem ambiguidade, indique a hora no fuso de Moscovo (GMT +3).

Diga-me também se vai precisar da gravação em vídeo do nosso encontro. Preciso de o saber antecipadamente, para ligar a gravação no Zoom (onde decorrerá o nosso encontro). Nesse caso, depois da consulta, envio-lhe uma ligação para descarregar o ficheiro de vídeo dessa gravação. Uma semana depois apago esse ficheiro do Zoom, para que não fique guardado em lado nenhum senão consigo. Recomendo que use esta possibilidade, porque na consulta podemos tocar em temas que, de um modo curioso, se esquecem depressa (é assim que funcionam os mecanismos de defesa da psique), e também falar dessas práticas e realizá-las, caso mais tarde precise de as rever.

Com os melhores cumprimentos,
Sergei Zamkovoi$pt$,
    'nl', $nl$Hallo {{name}},

dank je wel voor je aanmelding voor een healing-sessie. Geef alsjeblieft een paar opties (datum/tijd) die jou schikken voor onze ontmoeting. Zodat we elkaar eenduidig begrijpen, geef de tijd in de tijdzone van Moskou (GMT +3).

Zeg ook of je een video-opname van onze ontmoeting nodig hebt. Dat moet ik van tevoren weten, zodat ik in Zoom (waar onze ontmoeting plaatsvindt) de opname kan aanzetten. In dat geval stuur ik je na het consult een link om het videobestand van deze opname te downloaden. Een week later verwijder ik dit bestand uit Zoom, zodat het nergens bewaard blijft behalve bij jou. Ik raad je aan hiervan gebruik te maken, omdat we in een consult thema's kunnen aanraken die op een wonderlijke manier snel vergeten worden (zo werken de afweermechanismen van de psyche), en ook praktijken bespreken en doen die je later misschien opnieuw wilt bekijken.

Met vriendelijke groet,
Sergei Zamkovoi$nl$
  )
)
on conflict (provider, tier, currency) do update
set amount = excluded.amount,
    title = excluded.title,
    description = excluded.description,
    product_kind = excluded.product_kind,
    lava_offer_id = excluded.lava_offer_id,
    webinar_credits = null,
    webinar_window_days = null,
    sort_order = excluded.sort_order,
    letter_subject_i18n = excluded.letter_subject_i18n,
    letter_body_i18n = excluded.letter_body_i18n,
    active = true,
    updated_at = now();

-- Виджет как у месячного курса йоги: имя, почта, цена, выбор карты, прозрачный фон.
create or replace function pg_temp.booking_widget_config(p_texts jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'defaultLocale', 'ru',
    'paymentMode', 'choice',
    'successUrl', null,
    'requireName', true,
    'elements', jsonb_build_array(
      jsonb_build_object('type', 'title', 'visible', false),
      jsonb_build_object('type', 'text', 'visible', false),
      jsonb_build_object('type', 'method', 'visible', true),
      jsonb_build_object('type', 'price', 'visible', true),
      jsonb_build_object('type', 'name', 'visible', true),
      jsonb_build_object('type', 'email', 'visible', true),
      jsonb_build_object('type', 'button', 'visible', true),
      jsonb_build_object('type', 'footer', 'visible', true)
    ),
    'style', jsonb_build_object(
      'align', 'center',
      'radius', 12,
      'fontSize', 16,
      'maxWidth', 480,
      'paddingX', 24,
      'textColor', '#1f2937',
      'titleSize', 24,
      'background', 'transparent',
      'fontFamily', 'Montserrat, Arial, sans-serif',
      'paddingTop', 24,
      'accentColor', '#61a5ff',
      'borderColor', '#ffffff',
      'borderWidth', 0,
      'controlRadius', 6,
      'paddingBottom', 24,
      'buttonTextColor', '#ffffff'
    ),
    'texts', p_texts
  );
$$;

insert into public.payment_widgets (title, catalog_id, config)
select
  'Диагностика',
  c.id,
  pg_temp.booking_widget_config(jsonb_build_object(
    'ru', jsonb_build_object(
      'thanksTitle', 'Спасибо за оплату!',
      'thanksBody', 'Письмо уже отправлено на вашу почту. Ответьте на него и пришлите ответы на вопросы для диагностики. Если письма нет в течение 10 минут, проверьте папку «спам» или напишите на sergei@zamkovoi.yoga'
    ),
    'en', jsonb_build_object(
      'thanksTitle', 'Thank you for your payment!',
      'thanksBody', 'The email is already on its way. Please reply with your answers to the diagnostic questions. If it does not arrive within 10 minutes, check your spam folder or write to sergei@zamkovoi.yoga'
    ),
    'de', jsonb_build_object(
      'thanksTitle', 'Vielen Dank für Ihre Zahlung!',
      'thanksBody', 'Die E-Mail ist bereits unterwegs. Bitte antworten Sie darauf und schicken Sie die Antworten auf die Fragen zur Diagnostik. Wenn sie innerhalb von 10 Minuten nicht ankommt, prüfen Sie den Spam-Ordner oder schreiben Sie an sergei@zamkovoi.yoga'
    ),
    'fr', jsonb_build_object(
      'thanksTitle', 'Merci pour votre paiement !',
      'thanksBody', 'L''e-mail est déjà en route. Répondez-y en envoyant vos réponses aux questions du diagnostic. S''il n''arrive pas dans les 10 minutes, vérifiez les courriers indésirables ou écrivez à sergei@zamkovoi.yoga'
    ),
    'it', jsonb_build_object(
      'thanksTitle', 'Grazie per il pagamento!',
      'thanksBody', 'L''email è già in viaggio. Risponda inviando le risposte alle domande per la diagnosi. Se non arriva entro 10 minuti, controlli la cartella spam oppure scriva a sergei@zamkovoi.yoga'
    ),
    'es', jsonb_build_object(
      'thanksTitle', '¡Gracias por tu pago!',
      'thanksBody', 'El correo ya va de camino. Respóndelo con las respuestas a las preguntas del diagnóstico. Si no llega en 10 minutos, revisa el spam o escribe a sergei@zamkovoi.yoga'
    ),
    'pt', jsonb_build_object(
      'thanksTitle', 'Obrigado pelo seu pagamento!',
      'thanksBody', 'O e-mail já está a caminho. Responda com as respostas às perguntas do diagnóstico. Se não chegar em 10 minutos, verifique o spam ou escreva para sergei@zamkovoi.yoga'
    ),
    'nl', jsonb_build_object(
      'thanksTitle', 'Bedankt voor je betaling!',
      'thanksBody', 'De e-mail is al onderweg. Beantwoord hem met de antwoorden op de vragen voor de diagnostiek. Als hij er binnen 10 minuten niet is, kijk dan in de spam of schrijf naar sergei@zamkovoi.yoga'
    )
  ))
from public.payment_catalog c
where c.provider = 'yookassa' and c.tier = 'diagnostics' and c.currency = 'RUB'
  and not exists (
    select 1 from public.payment_widgets pw where pw.title = 'Диагностика'
  );

insert into public.payment_widgets (title, catalog_id, config)
select
  'Консультация',
  c.id,
  pg_temp.booking_widget_config(jsonb_build_object(
    'ru', jsonb_build_object(
      'thanksTitle', 'Спасибо за оплату!',
      'thanksBody', 'Письмо уже отправлено на вашу почту. Ответьте на него: укажите несколько удобных вариантов даты и времени по Москве (GMT +3) и напишите, нужна ли видеозапись встречи. Если письма нет в течение 10 минут, проверьте папку «спам» или напишите на sergei@zamkovoi.yoga'
    ),
    'en', jsonb_build_object(
      'thanksTitle', 'Thank you for your payment!',
      'thanksBody', 'The email is already on its way. Please reply with a few dates and times that suit you, in Moscow time (GMT +3), and say whether you need a video recording of the meeting. If it does not arrive within 10 minutes, check your spam folder or write to sergei@zamkovoi.yoga'
    ),
    'de', jsonb_build_object(
      'thanksTitle', 'Vielen Dank für Ihre Zahlung!',
      'thanksBody', 'Die E-Mail ist bereits unterwegs. Antworten Sie bitte mit einigen passenden Terminen (Datum und Uhrzeit) nach Moskauer Zeit (GMT +3) und schreiben Sie, ob Sie eine Videoaufzeichnung des Treffens benötigen. Wenn sie innerhalb von 10 Minuten nicht ankommt, prüfen Sie den Spam-Ordner oder schreiben Sie an sergei@zamkovoi.yoga'
    ),
    'fr', jsonb_build_object(
      'thanksTitle', 'Merci pour votre paiement !',
      'thanksBody', 'L''e-mail est déjà en route. Répondez-y en indiquant plusieurs dates et heures qui vous conviennent, à l''heure de Moscou (GMT +3), et dites si vous avez besoin d''un enregistrement vidéo de la rencontre. S''il n''arrive pas dans les 10 minutes, vérifiez les courriers indésirables ou écrivez à sergei@zamkovoi.yoga'
    ),
    'it', jsonb_build_object(
      'thanksTitle', 'Grazie per il pagamento!',
      'thanksBody', 'L''email è già in viaggio. Risponda indicando alcune date e orari comodi, nell''ora di Mosca (GMT +3), e dica se le serve la registrazione video dell''incontro. Se non arriva entro 10 minuti, controlli la cartella spam oppure scriva a sergei@zamkovoi.yoga'
    ),
    'es', jsonb_build_object(
      'thanksTitle', '¡Gracias por tu pago!',
      'thanksBody', 'El correo ya va de camino. Respóndelo con varias fechas y horas que te vengan bien, en horario de Moscú (GMT +3), y di si necesitas la grabación en vídeo del encuentro. Si no llega en 10 minutos, revisa el spam o escribe a sergei@zamkovoi.yoga'
    ),
    'pt', jsonb_build_object(
      'thanksTitle', 'Obrigado pelo seu pagamento!',
      'thanksBody', 'O e-mail já está a caminho. Responda com algumas datas e horas que lhe convenham, na hora de Moscovo (GMT +3), e diga se precisa da gravação em vídeo do encontro. Se não chegar em 10 minutos, verifique o spam ou escreva para sergei@zamkovoi.yoga'
    ),
    'nl', jsonb_build_object(
      'thanksTitle', 'Bedankt voor je betaling!',
      'thanksBody', 'De e-mail is al onderweg. Beantwoord hem met een paar data en tijden die jou schikken, in Moskou-tijd (GMT +3), en zeg of je een video-opname van de ontmoeting nodig hebt. Als hij er binnen 10 minuten niet is, kijk dan in de spam of schrijf naar sergei@zamkovoi.yoga'
    )
  ))
from public.payment_catalog c
where c.provider = 'yookassa' and c.tier = 'consultation' and c.currency = 'RUB'
  and not exists (
    select 1 from public.payment_widgets pw where pw.title = 'Консультация'
  );

insert into public.payment_widgets (title, catalog_id, config)
select
  'Целительная сессия',
  c.id,
  pg_temp.booking_widget_config(jsonb_build_object(
    'ru', jsonb_build_object(
      'thanksTitle', 'Спасибо за оплату!',
      'thanksBody', 'Письмо уже отправлено на вашу почту. Ответьте на него: укажите несколько удобных вариантов даты и времени по Москве (GMT +3) и напишите, нужна ли видеозапись встречи. Если письма нет в течение 10 минут, проверьте папку «спам» или напишите на sergei@zamkovoi.yoga'
    ),
    'en', jsonb_build_object(
      'thanksTitle', 'Thank you for your payment!',
      'thanksBody', 'The email is already on its way. Please reply with a few dates and times that suit you, in Moscow time (GMT +3), and say whether you need a video recording of the meeting. If it does not arrive within 10 minutes, check your spam folder or write to sergei@zamkovoi.yoga'
    ),
    'de', jsonb_build_object(
      'thanksTitle', 'Vielen Dank für Ihre Zahlung!',
      'thanksBody', 'Die E-Mail ist bereits unterwegs. Antworten Sie bitte mit einigen passenden Terminen (Datum und Uhrzeit) nach Moskauer Zeit (GMT +3) und schreiben Sie, ob Sie eine Videoaufzeichnung des Treffens benötigen. Wenn sie innerhalb von 10 Minuten nicht ankommt, prüfen Sie den Spam-Ordner oder schreiben Sie an sergei@zamkovoi.yoga'
    ),
    'fr', jsonb_build_object(
      'thanksTitle', 'Merci pour votre paiement !',
      'thanksBody', 'L''e-mail est déjà en route. Répondez-y en indiquant plusieurs dates et heures qui vous conviennent, à l''heure de Moscou (GMT +3), et dites si vous avez besoin d''un enregistrement vidéo de la rencontre. S''il n''arrive pas dans les 10 minutes, vérifiez les courriers indésirables ou écrivez à sergei@zamkovoi.yoga'
    ),
    'it', jsonb_build_object(
      'thanksTitle', 'Grazie per il pagamento!',
      'thanksBody', 'L''email è già in viaggio. Risponda indicando alcune date e orari comodi, nell''ora di Mosca (GMT +3), e dica se le serve la registrazione video dell''incontro. Se non arriva entro 10 minuti, controlli la cartella spam oppure scriva a sergei@zamkovoi.yoga'
    ),
    'es', jsonb_build_object(
      'thanksTitle', '¡Gracias por tu pago!',
      'thanksBody', 'El correo ya va de camino. Respóndelo con varias fechas y horas que te vengan bien, en horario de Moscú (GMT +3), y di si necesitas la grabación en vídeo del encuentro. Si no llega en 10 minutos, revisa el spam o escribe a sergei@zamkovoi.yoga'
    ),
    'pt', jsonb_build_object(
      'thanksTitle', 'Obrigado pelo seu pagamento!',
      'thanksBody', 'O e-mail já está a caminho. Responda com algumas datas e horas que lhe convenham, na hora de Moscovo (GMT +3), e diga se precisa da gravação em vídeo do encontro. Se não chegar em 10 minutos, verifique o spam ou escreva para sergei@zamkovoi.yoga'
    ),
    'nl', jsonb_build_object(
      'thanksTitle', 'Bedankt voor je betaling!',
      'thanksBody', 'De e-mail is al onderweg. Beantwoord hem met een paar data en tijden die jou schikken, in Moskou-tijd (GMT +3), en zeg of je een video-opname van de ontmoeting nodig hebt. Als hij er binnen 10 minuten niet is, kijk dan in de spam of schrijf naar sergei@zamkovoi.yoga'
    )
  ))
from public.payment_catalog c
where c.provider = 'yookassa' and c.tier = 'healing_session' and c.currency = 'RUB'
  and not exists (
    select 1 from public.payment_widgets pw where pw.title = 'Целительная сессия'
  );
