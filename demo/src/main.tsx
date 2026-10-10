import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import Landing from './pages/Landing';
import RecruiterHome from './pages/recruiter/RecruiterHome';
import TestDetail from './pages/recruiter/TestDetail';
import CandidateFlow from './pages/candidate/CandidateFlow';
import CandidateReport from './pages/candidate/CandidateReport';
import ReviewerInbox from './pages/reviewer/ReviewerInbox';
import ReviewerReport from './pages/reviewer/ReviewerReport';
import Analytics from './pages/reviewer/Analytics';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/recruiter" element={<RecruiterHome />} />
        <Route path="/recruiter/tests/:testId" element={<TestDetail />} />
        <Route path="/t/:token" element={<CandidateFlow />} />
        <Route path="/t/:token/report" element={<CandidateReport />} />
        <Route path="/reviewer" element={<ReviewerInbox />} />
        <Route path="/reviewer/:candidateId" element={<ReviewerReport />} />
        <Route path="/analytics" element={<Analytics />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
