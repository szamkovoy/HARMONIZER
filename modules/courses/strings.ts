import type { AppContentLocale } from '@/modules/i18n/localeCodes';
const en={my:'My courses',all:'Received lessons',hide:'Hide lessons',empty:'Your courses will appear here. Choose the course that interests you most in your account.',expired:'Access has ended',period:'Access period',repeat:'You can take this course again.',available:'Available',lesson:'Lesson',tv:'Open on TV',retry:'Try again',error:'Could not load courses',loading:'Loading…',close:'Close',test:'Course preview',unavailable:'This lesson is not available yet.'};
type Strings=typeof en;
const translations:Record<AppContentLocale,Strings>={
 en,
 ru:{my:'Мои курсы',all:'Полученные уроки',hide:'Скрыть список уроков',empty:'Здесь появятся ваши курсы. Выбрать наиболее интересный курс вы можете в личном кабинете.',expired:'Доступ завершён',period:'Период доступа',repeat:'Вы можете пройти этот курс повторно.',available:'Доступен',lesson:'Урок',tv:'Открыть на ТВ',retry:'Повторить',error:'Не удалось загрузить курсы',loading:'Загружаем…',close:'Закрыть',test:'Проверка практикума',unavailable:'Этот урок пока недоступен.'},
 de:{my:'Meine Kurse',all:'Erhaltene Lektionen',hide:'Lektionen ausblenden',empty:'Hier erscheinen Ihre Kurse. Wählen Sie in Ihrem Konto den Kurs, der Sie am meisten interessiert.',expired:'Zugang abgelaufen',period:'Zugangszeitraum',repeat:'Sie können diesen Kurs erneut absolvieren.',available:'Verfügbar',lesson:'Lektion',tv:'Auf dem TV öffnen',retry:'Erneut versuchen',error:'Kurse konnten nicht geladen werden',loading:'Laden…',close:'Schließen',test:'Kursvorschau',unavailable:'Diese Lektion ist noch nicht verfügbar.'},
 fr:{my:'Mes cours',all:'Leçons reçues',hide:'Masquer les leçons',empty:'Vos cours apparaîtront ici. Choisissez le cours qui vous intéresse le plus dans votre espace personnel.',expired:'Accès terminé',period:'Période d’accès',repeat:'Vous pouvez suivre ce cours à nouveau.',available:'Disponible',lesson:'Leçon',tv:'Ouvrir sur la TV',retry:'Réessayer',error:'Impossible de charger les cours',loading:'Chargement…',close:'Fermer',test:'Aperçu du cours',unavailable:'Cette leçon n’est pas encore disponible.'},
 it:{my:'I miei corsi',all:'Lezioni ricevute',hide:'Nascondi le lezioni',empty:'I tuoi corsi appariranno qui. Scegli il corso che ti interessa di più nella tua area personale.',expired:'Accesso terminato',period:'Periodo di accesso',repeat:'Puoi seguire di nuovo questo corso.',available:'Disponibile',lesson:'Lezione',tv:'Apri sulla TV',retry:'Riprova',error:'Impossibile caricare i corsi',loading:'Caricamento…',close:'Chiudi',test:'Anteprima del corso',unavailable:'Questa lezione non è ancora disponibile.'},
 es:{my:'Mis cursos',all:'Lecciones recibidas',hide:'Ocultar lecciones',empty:'Tus cursos aparecerán aquí. Elige el curso que más te interese en tu área personal.',expired:'Acceso finalizado',period:'Periodo de acceso',repeat:'Puedes volver a realizar este curso.',available:'Disponible',lesson:'Lección',tv:'Abrir en la TV',retry:'Reintentar',error:'No se pudieron cargar los cursos',loading:'Cargando…',close:'Cerrar',test:'Vista previa del curso',unavailable:'Esta lección aún no está disponible.'},
 pt:{my:'Os meus cursos',all:'Lições recebidas',hide:'Ocultar lições',empty:'Os seus cursos aparecerão aqui. Escolha o curso que mais lhe interessa na sua área pessoal.',expired:'Acesso terminado',period:'Período de acesso',repeat:'Pode voltar a fazer este curso.',available:'Disponível',lesson:'Lição',tv:'Abrir na TV',retry:'Tentar novamente',error:'Não foi possível carregar os cursos',loading:'A carregar…',close:'Fechar',test:'Pré-visualização do curso',unavailable:'Esta lição ainda não está disponível.'},
 nl:{my:'Mijn cursussen',all:'Ontvangen lessen',hide:'Lessen verbergen',empty:'Uw cursussen verschijnen hier. Kies de cursus die u het meest interesseert in uw account.',expired:'Toegang verlopen',period:'Toegangsperiode',repeat:'U kunt deze cursus opnieuw volgen.',available:'Beschikbaar',lesson:'Les',tv:'Openen op tv',retry:'Opnieuw proberen',error:'Cursussen konden niet worden geladen',loading:'Laden…',close:'Sluiten',test:'Cursusvoorbeeld',unavailable:'Deze les is nog niet beschikbaar.'}
};
export const courseStrings=(locale:string):Strings=>translations[locale as AppContentLocale]||en;

const controls:Record<AppContentLocale,{previous:string;next:string;cabinet:string}>={
 en:{previous:'Previous lesson',next:'Next lesson',cabinet:'My account'},
 ru:{previous:'Предыдущий урок',next:'Следующий урок',cabinet:'Личный кабинет'},
 de:{previous:'Vorherige Lektion',next:'Nächste Lektion',cabinet:'Mein Konto'},
 fr:{previous:'Leçon précédente',next:'Leçon suivante',cabinet:'Mon compte'},
 it:{previous:'Lezione precedente',next:'Lezione successiva',cabinet:'Area personale'},
 es:{previous:'Lección anterior',next:'Lección siguiente',cabinet:'Mi cuenta'},
 pt:{previous:'Lição anterior',next:'Lição seguinte',cabinet:'Área pessoal'},
 nl:{previous:'Vorige les',next:'Volgende les',cabinet:'Mijn account'}
};
export const courseControls=(locale:string)=>controls[locale as AppContentLocale]||controls.en;
export function courseLessonCount(locale:string,received:number,total:number):string {
 const language=locale in translations?locale as AppContentLocale:'en';
 const of={en:'of',ru:'из',de:'von',fr:'sur',it:'di',es:'de',pt:'de',nl:'van'};
 if(received<total)return `${received} ${of[language]} ${total}`;
 const words:Record<AppContentLocale,Record<string,string>>={
 en:{one:'lesson',other:'lessons'},ru:{one:'урок',few:'урока',many:'уроков',other:'урока'},
 de:{one:'Lektion',other:'Lektionen'},fr:{one:'leçon',other:'leçons'},it:{one:'lezione',other:'lezioni'},
 es:{one:'lección',other:'lecciones'},pt:{one:'lição',other:'lições'},nl:{one:'les',other:'lessen'}
 };
 const form=new Intl.PluralRules(language).select(received);
 return `${received} ${words[language][form]||words[language].other}`;
}
