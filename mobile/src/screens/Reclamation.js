import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Carte, H, T, Muted, Champ, Bouton, Erreur, Pill } from '../ui';

// Réclamation bagage sans file d'attente : nom, vol, date, référence (PNR), numéro de billet.
export default function Reclamation({ passager, vol }) {
  const [f, setF] = useState({ nom: passager?.nom ?? '', vol: vol?.numero ?? '', date: vol?.date ?? '', reference: passager?.pnr ?? '', numeroBillet: '', codeEtiquette: '', description: '', telephone: '' });
  const [rec, setRec] = useState(null); const [err, setErr] = useState(''); const [att, setAtt] = useState(false);
  const [num, setNum] = useState(''); const [suivi, setSuivi] = useState(null);
  const m = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const envoyer = async () => {
    setErr(''); setAtt(true);
    try { setRec(await api('POST', '/api/reclamations', f));  } catch (e) { setErr(e.message); }
    setAtt(false);
  };
  const voir = async () => {
    setErr('');
    try { setSuivi(await api('GET', `/api/reclamations/${encodeURIComponent((rec?.numero ?? num).trim())}?nom=${encodeURIComponent(f.nom)}`)); } catch (e) { setErr(e.message); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
      <Carte>
        <H>Réclamation bagage</H>
        <Muted style={{ marginBottom: 10 }}>Perdu, retardé ou endommagé : déclarez-le ici, sans faire la queue. Les dossiers VIP vérifiés sont traités en priorité.</Muted>
        <Champ label="Nom du passager" value={f.nom} onChangeText={m('nom')} autoCapitalize="words" />
        <Champ label="Numéro de vol" value={f.vol} onChangeText={m('vol')} autoCapitalize="characters" placeholder="ex. KQ554" />
        <Champ label="Date du vol (AAAA-MM-JJ)" value={f.date} onChangeText={m('date')} placeholder="2026-11-12" />
        <Champ label="Référence de réservation (PNR)" value={f.reference} onChangeText={m('reference')} autoCapitalize="characters" />
        <Champ label="Numéro de billet (10 à 14 chiffres)" value={f.numeroBillet} onChangeText={m('numeroBillet')} keyboardType="numeric" />
        <Champ label="Numéro d’étiquette bagage (facultatif)" value={f.codeEtiquette} onChangeText={m('codeEtiquette')} autoCapitalize="characters" />
        <Champ label="Téléphone (facultatif)" value={f.telephone} onChangeText={m('telephone')} keyboardType="phone-pad" />
        <Champ label="Description" value={f.description} onChangeText={m('description')} multiline style={{ minHeight: 70 }} />
        <Erreur>{err}</Erreur>
        <Bouton titre="Envoyer la réclamation" onPress={envoyer} chargement={att} couleur={C.rouge} />
      </Carte>
      {rec ? <Carte style={{ backgroundColor: '#e9f7ef' }}>
        <T style={{ fontWeight: '700' }}>Réclamation enregistrée</T>
        <T style={{ fontSize: 22, fontWeight: '800' }}>{rec.numero}</T>
        {rec.priorite === 'PRIORITAIRE' ? <Pill texte="PRIORITAIRE · VIP" couleur={C.orange} /> : null}
        <Muted style={{ marginTop: 6 }}>{rec.message}</Muted>
        <Bouton titre="Voir l’état du dossier" onPress={voir} couleur={C.vert} />
      </Carte> : null}
      {!rec ? <Carte><H>Suivre une réclamation</H>
        <Champ label="Numéro (RC-XXXXXX)" value={num} onChangeText={(v) => setNum(v.toUpperCase())} autoCapitalize="characters" />
        <Bouton titre="Suivre" onPress={voir} desactive={!num || !f.nom} couleur={C.bleu2} /></Carte> : null}
      {suivi ? <Carte><T style={{ fontWeight: '700' }}>{suivi.numero} · {suivi.libelleStatut}</T>
        <Muted>Vol {suivi.vol} du {suivi.date}</Muted>
        {suivi.reponse ? <T style={{ marginTop: 6 }}>Réponse : {suivi.reponse}</T> : <Muted>Pas encore de réponse de l’agent.</Muted>}</Carte> : null}
    </ScrollView>
  );
}
